import type { Goal } from '@10x-media/analytics'
import { createLocalReq, type Payload } from 'payload'
import { isClosed, localDay } from '../../src/native/engine/days'
import type { DayTarget } from '../../src/native/engine/engine'
import { type NativeInstance, nativeInstanceOf } from '../../src/native/engine/instance'
import { toHit } from '../../src/native/engine/toHit'
import { normalizeEvent } from '../../src/native/ingest/normalizeEvent'
import { createUlidFactory } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { getRuntime, resolveCurrencyFor, resolveGoalsFor } from '../../src/plugin/runtime'
import { addCalendarDays, type CalendarDay, calendarDayOf } from '../../src/timeframe/calendar'
import { devConvert } from '../config/shared'
import { devMemoryAdapter } from './adapters'
import { idEntropy, type PlannedVisit, planDay, type SiteProfile } from './traffic'

/** Nine weeks before today: the last 30 days and the 30 they are compared with, both full. */
export const SEED_DAYS = 63

/** Closed days counted at once; past a handful the database only queues them. */
const AGGREGATE_CONCURRENCY = 4

/** What one boot's seed did: hits written and days counted, and how long each part took. */
export interface TrafficReport {
	hits: number
	days: number
	storeMs: number
	countMs: number
}

const nativeOf = (payload: Payload): NativeInstance => {
	const instance = nativeInstanceOf(payload)
	if (!instance) {
		throw new Error('analytics dev seed: the native adapter is not attached to this instance')
	}
	return instance
}

/** The memory provider counts pageviews only, so only planned pageviews go to it. */
const mirrorPageviews = (visits: readonly PlannedVisit[], now: Date): void => {
	for (const visit of visits) {
		for (const hit of visit.hits) {
			if (hit.raw.type === 'pageview' && hit.at < now) {
				devMemoryAdapter.record({ path: hit.raw.path, timestamp: hit.at, visitor: visit.visitor })
			}
		}
	}
}

interface SiteContext {
	site: SiteProfile
	instance: NativeInstance
	goals: Goal[]
	currency: string | undefined
	now: Date
}

/**
 * A day's planned hits stored as ingest stores beacons: normalized from what the browser would
 * send, item refs checked against their signatures, goals matched and amounts converted, then
 * shaped by `toHit` under ids fixed by each hit's key. Nothing that has not happened by `now` is
 * kept: a later boot stores it, and the ids it already stored are skipped.
 */
const rowsOf = async (context: SiteContext, visits: readonly PlannedVisit[]): Promise<HitRow[]> => {
	const { site, instance, goals, currency, now } = context
	const rows: HitRow[] = []
	for (const visit of visits) {
		const { persona } = visit
		const headers = new Headers({
			'user-agent': persona.ua,
			'accept-language': persona.acceptLanguage,
			'x-forwarded-for': persona.ip,
		})
		const geo = { country: persona.country, region: persona.region, city: persona.city }
		for (const planned of visit.hits) {
			if (planned.at >= now || planned.arrives > now) {
				continue
			}
			const event = await normalizeEvent({
				raw: planned.raw,
				hostname: site.hostname,
				headers: planned.server ? new Headers() : headers,
				geoResolver: () => (planned.server ? {} : geo),
				salt: `analytics-dev-seed:${calendarDayOf(planned.at, site.tz)}`,
				now: planned.at,
				...(site.scope === undefined ? {} : { scope: site.scope }),
				goals,
				origin: planned.server ? 'server' : 'wire',
				reportingCurrency: currency,
				convertCurrency: devConvert,
				trustedProxyHops: 1,
				...(instance.items ? { items: instance.items } : {}),
			})
			const ids = createUlidFactory(() => idEntropy(planned.key))
			rows.push(toHit(event, { receivedAt: planned.arrives, ids }))
		}
	}
	return rows
}

/** Every day in `targets`, counted as maintenance counts a closed day, a few at a time. */
const aggregateAll = async (instance: NativeInstance, targets: DayTarget[]): Promise<void> => {
	const queue = [...targets]
	const worker = async (): Promise<void> => {
		for (let target = queue.pop(); target; target = queue.pop()) {
			await instance.engine.aggregate(target)
		}
	}
	await Promise.all(Array.from({ length: AGGREGATE_CONCURRENCY }, worker))
}

/**
 * Fills each site's last {@link SEED_DAYS} days and today so far, and counts every closed day, so
 * the dashboards open complete. Every boot mirrors the pageviews into the in-memory provider; a day
 * already counted for good is left alone, and every other day is stored again, its existing rows
 * skipped by id, which is what lets a persistent database catch up on the days since its last boot.
 */
export const seedTraffic = async (
	payload: Payload,
	sites: readonly SiteProfile[]
): Promise<TrafficReport> => {
	const started = Date.now()
	const instance = nativeOf(payload)
	const runtime = getRuntime(payload)
	if (!runtime) {
		throw new Error('analytics dev seed: the analytics plugin has no runtime on this instance')
	}
	const req = await createLocalReq({}, payload)
	const now = new Date()
	let hits = 0
	const targets: DayTarget[] = []
	for (const site of sites) {
		const scope = site.scope ?? ''
		const context: SiteContext = {
			site,
			instance,
			goals: await resolveGoalsFor(runtime, req, scope || null),
			currency: await resolveCurrencyFor(runtime, req, scope || null),
			now,
		}
		const today = calendarDayOf(now, site.tz)
		const first = addCalendarDays(today, -SEED_DAYS)
		const final = new Set(
			(await instance.state.markers(scope, first, today))
				.filter((marker) => marker.status === 'final')
				.map((marker) => marker.day)
		)
		for (let day: CalendarDay = first; day <= today; day = addCalendarDays(day, 1)) {
			const visits = planDay(site, day, now)
			mirrorPageviews(visits, now)
			if (final.has(day)) {
				continue
			}
			const rows = await rowsOf(context, visits)
			hits += (await instance.store.append(rows)).written
			if (isClosed(localDay(day, site.tz), now)) {
				targets.push({ scope, day, tz: site.tz })
			}
		}
	}
	const stored = Date.now()
	await aggregateAll(instance, targets)
	return {
		hits,
		days: targets.length,
		storeMs: stored - started,
		countMs: Date.now() - stored,
	}
}
