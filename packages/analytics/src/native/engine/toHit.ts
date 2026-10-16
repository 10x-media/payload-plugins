import { MAX_ITEMS_PER_BEACON } from '../../goals/constants'
import type { NormalizedEvent } from '../ingest/normalizeEvent'
import { isSelfReferral } from '../ingest/referrer'
import { CHANNEL_TAXONOMY_VERSION, classifyChannel, deriveSource } from '../ingest/source'
import { orderHitId, type UlidFactory, ulid } from '../store/ids'
import type { HitRow } from '../store/types'

interface HitContext {
	/** When the beacon arrived, or the server call was made: where an engagement's reading ends. */
	receivedAt: Date
	/** Makes a hit's id out of its time; the process's own factory unless a test hands one in. */
	ids?: UlidFactory
}

/**
 * Whether a hit opens a visit: a document-loading pageview no page of its scope's hostnames linked
 * to. Events, goals and engagements never do: their referrer is the one their page loaded with.
 */
export const isLanding = (
	event: Pick<NormalizedEvent, 'type' | 'navigation' | 'referrer' | 'hostname' | 'siteReferrer'>
): boolean =>
	event.type === 'pageview' &&
	event.navigation !== true &&
	event.siteReferrer !== true &&
	!isSelfReferral(event.referrer, event.hostname)

/**
 * Where a visit came from: the referrer on a landing alone, tags and click id on any hit. A hit
 * with no visitor claims no source unless it carries one, or is a page's landing: a webhook is not
 * direct traffic, and an anonymous page further into a visit is not either.
 */
const acquisitionOf = (event: NormalizedEvent, landing: boolean): Partial<HitRow> => {
	const ref = landing ? event.referrerHost : undefined
	const tagged =
		ref !== undefined ||
		event.clickId !== undefined ||
		[event.utmSource, event.utmMedium, event.utmCampaign, event.utmContent, event.utmTerm].some(
			(tag) => tag !== undefined
		)
	if (event.visitorId === '' && !tagged && (event.server === true || !landing)) {
		return {}
	}
	return {
		ref,
		source: deriveSource({ referrerHost: ref, utmSource: event.utmSource }),
		channel: classifyChannel({
			referrerHost: ref,
			utmSource: event.utmSource,
			utmMedium: event.utmMedium,
			clickId: event.clickId,
		}),
		channelVersion: CHANNEL_TAXONOMY_VERSION,
		clickId: event.clickId,
		utmSource: event.utmSource,
		utmMedium: event.utmMedium,
		utmCampaign: event.utmCampaign,
		utmContent: event.utmContent,
		utmTerm: event.utmTerm,
	}
}

/** Drops the fields a row leaves out, so an absent one is missing rather than undefined. */
const withoutAbsent = (hit: HitRow): HitRow => {
	for (const key of Object.keys(hit)) {
		if (Reflect.get(hit, key) === undefined) {
			Reflect.deleteProperty(hit, key)
		}
	}
	return hit
}

/**
 * The row a normalized event is stored as. An order's id is its dedupe key, so a retried order
 * meets its own primary key; an engagement keeps its pageview's `ts`, its arrival as `lastAt`.
 */
export const toHit = (event: NormalizedEvent, context: HitContext): HitRow => {
	const landing = isLanding(event)
	const hit: HitRow = {
		id:
			event.dedupeKey === undefined
				? (context.ids ?? ulid)(event.timestamp)
				: orderHitId(event.dedupeKey),
		scope: event.scope ?? '',
		ts: event.timestamp,
		type: event.type,
		hostname: event.hostname,
		path: event.path,
		v: event.visitorId ?? '',
		landing,
		server: event.server === true,
		mode: event.mode ?? 'f',
		durationMs: event.durationMs,
		scrollDepth: event.scrollDepth,
	}
	if (event.type === 'engagement') {
		const seen = event.impressions?.slice(0, MAX_ITEMS_PER_BEACON) ?? []
		return withoutAbsent({
			...hit,
			lastAt: new Date(Math.max(event.timestamp.getTime(), context.receivedAt.getTime())),
			...(seen.length > 0 ? { impressions: seen } : {}),
		})
	}
	const goals = event.goals ?? []
	const revenue = goals.reduce((sum, completion) => sum + completion.value, 0)
	// A pageview has no currency: a configured one is stamped on every event, money or not.
	const money = event.value !== undefined || event.originalValue !== undefined || goals.length > 0
	return withoutAbsent({
		...hit,
		...acquisitionOf(event, landing),
		name: event.name,
		country: event.country,
		region: event.region,
		city: event.city,
		language: event.language,
		device: event.device,
		browser: event.browser,
		os: event.os,
		value: event.value,
		originalValue: event.originalValue,
		currency: money ? event.currency : undefined,
		originalCurrency: event.originalCurrency,
		item: event.item,
		props: event.props,
		// A refund takes money back from a sale that still happened: revenue, and no conversion.
		...(goals.length > 0 ? { goals, conversions: event.refund ? 0 : goals.length, revenue } : {}),
	})
}
