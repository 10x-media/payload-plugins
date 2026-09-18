import { type GoalCompletion, matchGoals } from '../../goals/match'
import type { Goal } from '../../goals/types'
import { MAX_GEO_LENGTH, MAX_QUERY_LENGTH, MAX_REFERRER_LENGTH } from '../../query/limits'
import type { GeoResolver } from '../geo/geoResolver'
import { type BrowserName, classifyBrowser, classifyOs, type OsName } from './browser'
import { clientIpFromHeaders } from './clientIp'
import { classifyDevice, type DeviceType } from './device'
import { primaryLanguage } from './language'
import { referrerHost, storedReferrer } from './referrer'
import { CHANNEL_TAXONOMY_VERSION, classifyChannel, deriveSource } from './source'
import { extractUtm } from './utm'
import { dailyVisitorHash, deriveSessionId } from './visitorHash'

/** The wire caps, re-exported beside the sanitizers that apply them. */
export { MAX_GEO_LENGTH, MAX_QUERY_LENGTH, MAX_REFERRER_LENGTH }

export type EventType = 'pageview' | 'event' | 'goal'

export interface RawEventInput {
	type: EventType
	/** Event name, or the goal slug on a `goal`. Absent on pageviews. */
	name?: string
	path: string
	hostname: string
	referrer?: string
	/**
	 * The page's query string, without its leading `?`. Read for its utm keys and then
	 * discarded: it is never stored, so a session token or an email address that happens to
	 * be in the URL never lands in the events collection.
	 */
	query?: string
	durationMs?: number
	props?: Record<string, unknown>
	/** Revenue for a goal completion, in `currency`. */
	value?: number
	currency?: string
	/** Max scroll depth reached on a pageview, 0-100. */
	scrollDepth?: number
}

export interface StoredEvent {
	timestamp: Date
	type: EventType
	name?: string
	path: string
	hostname: string
	/** Origin and path only: the query string and fragment are stripped before storage. */
	referrer?: string
	/**
	 * The referrer's bare host, derived at ingest because a `where` cannot derive it at read
	 * time: it is what the `referrer` dimension buckets and filters on.
	 */
	referrerHost?: string
	device?: DeviceType
	browser?: BrowserName
	os?: OsName
	/**
	 * The visit's named origin: its `utm_source`, else the referrer host, else `direct`.
	 * Typed as a string because a row written before this classification holds whatever the
	 * rules of its day decided, and rows are never rewritten.
	 */
	source?: string
	/** The hit's acquisition channel (`TrafficChannel`), classified from the origin above. */
	channel: string
	/**
	 * The taxonomy the `channel` beside it was decided under, so a later reclassify can find
	 * the rows an older rule set wrote.
	 */
	channelVersion: number
	/** The five campaign keys extracted from the wire `query`; absent when it carried none. */
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmContent?: string
	utmTerm?: string
	country?: string
	region?: string
	city?: string
	/** Primary `Accept-Language` tag, lowercased (`de-de`). */
	language?: string
	visitorHash: string
	sessionId: string
	durationMs?: number
	props?: Record<string, unknown>
	value?: number
	/** ISO 4217 code `value` is denominated in. Stored as sent; revenue is never converted. */
	currency?: string
	scrollDepth?: number
	/**
	 * Goals this event completed, resolved against the install's goals at ingest so a later
	 * goal edit never rewrites history and a raw-event read can re-derive the same numbers
	 * the rollups hold.
	 */
	goals?: GoalCompletion[]
	/** Set only in scoped installs; '' is the null scope. */
	scope?: string
	/**
	 * Reporting timezone the rollup day bucket is computed in. In-memory only: stripped
	 * before the event row is persisted (day bucketing happens at rollup time). Absent
	 * means UTC.
	 */
	timezone?: string
}

export interface NormalizeArgs {
	raw: RawEventInput
	headers: Headers
	geoResolver: GeoResolver
	salt: string
	now: Date
	scope?: string
	timezone?: string
	/** Goals to match this event against; omitted means no goal matching. */
	goals?: Goal[]
}

const MAX_PROPS = 20
const MAX_KEY_LENGTH = 64
const MAX_VALUE_LENGTH = 256
const MAX_NAME_LENGTH = 128
const MAX_PATH_LENGTH = 512
/** Longest legal DNS name. */
const MAX_HOSTNAME_LENGTH = 253
/** 24 hours. A longer duration is a broken clock, not a session. */
const MAX_DURATION_MS = 86_400_000
const CURRENCY = /^[A-Z]{3}$/

/**
 * Optional wire fields are sanitized rather than rejected: a bad `value`, `currency`,
 * `scrollDepth`, `durationMs`, or prop is dropped and the event is still ingested, so one malformed
 * attribute never costs a pageview. Only the required fields (checked in the endpoint)
 * can fail an event.
 */
const nonNegative = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const currencyCode = (value: unknown): string | undefined =>
	typeof value === 'string' && CURRENCY.test(value) ? value : undefined

/**
 * Infinity would poison a rollup bucket's average for good, and a string would throw out of
 * the write and take the whole buffered batch with it, so a duration outside the ceiling is
 * dropped like any other malformed attribute.
 */
const duration = (value: unknown): number | undefined => {
	const n = nonNegative(value)
	return n === undefined || n > MAX_DURATION_MS ? undefined : n
}

/** The event name is a rollup bucket key (the `event` dimension), so it is length-capped. */
const eventName = (value: unknown): string | undefined =>
	typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : undefined

/**
 * A geo value as stored. The resolver reads request headers a client can set, and each value
 * becomes a rollup dimvalue and part of a seen-ledger key, so it is capped here rather than
 * trusted. An empty value stays absent: '' would be a bucket of its own.
 */
const geoValue = (value: string | undefined): string | undefined =>
	value ? value.slice(0, MAX_GEO_LENGTH) : undefined

/** Capped before it is parsed, so a hostile query cannot make ingest do unbounded work. */
const queryString = (value: unknown): string | undefined =>
	typeof value === 'string' ? value.slice(0, MAX_QUERY_LENGTH) : undefined

const depth = (value: unknown): number | undefined => {
	const n = nonNegative(value)
	return n === undefined ? undefined : Math.round(Math.min(n, 100))
}

/** Flat JSON scalars only: the first 20 short-keyed string/number/boolean entries. */
const sanitizeProps = (raw: unknown): Record<string, unknown> | undefined => {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return undefined
	}
	const out: Record<string, unknown> = {}
	let kept = 0
	for (const [key, value] of Object.entries(raw)) {
		if (kept >= MAX_PROPS || key.length > MAX_KEY_LENGTH) {
			continue
		}
		if (typeof value === 'string') {
			out[key] = value.slice(0, MAX_VALUE_LENGTH)
		} else if (
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value))
		) {
			out[key] = value
		} else {
			continue
		}
		kept++
	}
	return kept > 0 ? out : undefined
}

export async function normalizeEvent({
	raw,
	headers,
	geoResolver,
	salt,
	now,
	scope,
	timezone,
	goals,
}: NormalizeArgs): Promise<StoredEvent> {
	const geo = await geoResolver(headers)
	const ip = clientIpFromHeaders(headers) ?? ''
	const ua = headers.get('user-agent') ?? ''
	// Everything that becomes a rollup dimvalue or a seen-ledger key is capped before anything
	// derives from it: an uncapped value exceeds Mongo's index key limit, and on Postgres a
	// btree key over 2704 bytes fails the write outright. That covers path and hostname here,
	// the geo values below (a client can set the headers a resolver reads), and the event name,
	// query and referrer in their own sanitizers.
	const path = raw.path.slice(0, MAX_PATH_LENGTH)
	const hostname = raw.hostname.slice(0, MAX_HOSTNAME_LENGTH)
	const visitorHash = dailyVisitorHash({ ip, ua, site: hostname, salt })
	const hourBucket = now.toISOString().slice(0, 13)
	const props = sanitizeProps(raw.props)
	const value = nonNegative(raw.value)
	const scrollDepth = depth(raw.scrollDepth)
	const durationMs = duration(raw.durationMs)
	const name = eventName(raw.name)
	const device = classifyDevice(ua)
	const browser = classifyBrowser(ua)
	const os = classifyOs(ua)
	const language = primaryLanguage(headers.get('accept-language'))
	const refHost = referrerHost(raw.referrer, hostname)
	const query = queryString(raw.query)
	const utm = extractUtm(query)
	// Match on the sanitized fields so a rejected value never reaches a goal's revenue.
	const completions = goals?.length
		? matchGoals({ type: raw.type, name, path, props, value }, goals)
		: []
	return {
		timestamp: now,
		type: raw.type,
		name,
		path,
		hostname,
		referrer: storedReferrer(raw.referrer),
		...(refHost ? { referrerHost: refHost } : {}),
		...(device ? { device } : {}),
		...(browser ? { browser } : {}),
		...(os ? { os } : {}),
		source: deriveSource({ referrerHost: refHost, utmSource: utm.utmSource }),
		channel: classifyChannel({
			referrerHost: refHost,
			utmSource: utm.utmSource,
			utmMedium: utm.utmMedium,
			query,
		}),
		channelVersion: CHANNEL_TAXONOMY_VERSION,
		...utm,
		country: geoValue(geo.country),
		region: geoValue(geo.region),
		city: geoValue(geo.city),
		...(language ? { language } : {}),
		visitorHash,
		sessionId: deriveSessionId(visitorHash, hourBucket),
		props,
		...(durationMs !== undefined ? { durationMs } : {}),
		...(value !== undefined ? { value } : {}),
		...(currencyCode(raw.currency) !== undefined ? { currency: raw.currency } : {}),
		...(scrollDepth !== undefined ? { scrollDepth } : {}),
		...(completions.length > 0 ? { goals: completions } : {}),
		...(scope !== undefined ? { scope } : {}),
		...(timezone !== undefined ? { timezone } : {}),
	}
}
