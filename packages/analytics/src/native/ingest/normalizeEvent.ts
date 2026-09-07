import { type GoalCompletion, matchGoals } from '../../goals/match'
import type { Goal } from '../../goals/types'
import type { GeoResolver } from '../geo/geoResolver'
import { clientIpFromHeaders } from './clientIp'
import { classifyDevice, type DeviceType } from './device'
import { deriveSource } from './source'
import { dailyVisitorHash, deriveSessionId } from './visitorHash'

export type EventType = 'pageview' | 'event' | 'goal'

export interface RawEventInput {
	type: EventType
	/** Event name, or the goal slug on a `goal`. Absent on pageviews. */
	name?: string
	path: string
	hostname: string
	referrer?: string
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
	referrer?: string
	device?: DeviceType
	source?: string
	country?: string
	region?: string
	city?: string
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
const CURRENCY = /^[A-Z]{3}$/

/**
 * Optional wire fields are sanitized rather than rejected: a bad `value`, `currency`,
 * `scrollDepth`, or prop is dropped and the event is still ingested, so one malformed
 * attribute never costs a pageview. Only the required fields (checked in the endpoint)
 * can fail an event.
 */
const nonNegative = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const currencyCode = (value: unknown): string | undefined =>
	typeof value === 'string' && CURRENCY.test(value) ? value : undefined

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
	const visitorHash = dailyVisitorHash({ ip, ua, site: raw.hostname, salt })
	const hourBucket = now.toISOString().slice(0, 13)
	const props = sanitizeProps(raw.props)
	const value = nonNegative(raw.value)
	const scrollDepth = depth(raw.scrollDepth)
	// Match on the sanitized fields so a rejected value never reaches a goal's revenue.
	const completions = goals?.length
		? matchGoals({ type: raw.type, name: raw.name, path: raw.path, props, value }, goals)
		: []
	return {
		timestamp: now,
		type: raw.type,
		name: raw.name,
		path: raw.path,
		hostname: raw.hostname,
		referrer: raw.referrer,
		device: classifyDevice(ua),
		source: deriveSource(raw.referrer, raw.hostname),
		country: geo.country,
		region: geo.region,
		city: geo.city,
		visitorHash,
		sessionId: deriveSessionId(visitorHash, hourBucket),
		durationMs: raw.durationMs,
		props,
		...(value !== undefined ? { value } : {}),
		...(currencyCode(raw.currency) !== undefined ? { currency: raw.currency } : {}),
		...(scrollDepth !== undefined ? { scrollDepth } : {}),
		...(completions.length > 0 ? { goals: completions } : {}),
		...(scope !== undefined ? { scope } : {}),
		...(timezone !== undefined ? { timezone } : {}),
	}
}
