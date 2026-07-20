import type { GeoResolver } from '../geo/geoResolver'
import { classifyDevice, type DeviceType } from './device'
import { deriveSource } from './source'
import { dailyVisitorHash, deriveSessionId } from './visitorHash'

export interface RawEventInput {
	type: 'pageview' | 'event'
	name?: string
	path: string
	hostname: string
	referrer?: string
	durationMs?: number
	props?: Record<string, unknown>
}

export interface StoredEvent {
	timestamp: Date
	type: 'pageview' | 'event'
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
}

export async function normalizeEvent({
	raw,
	headers,
	geoResolver,
	salt,
	now,
	scope,
	timezone,
}: NormalizeArgs): Promise<StoredEvent> {
	const geo = await geoResolver(headers)
	const ip = (
		headers.get('x-forwarded-for')?.split(',')[0] ??
		headers.get('x-real-ip') ??
		''
	).trim()
	const ua = headers.get('user-agent') ?? ''
	const visitorHash = dailyVisitorHash({ ip, ua, site: raw.hostname, salt })
	const hourBucket = now.toISOString().slice(0, 13)
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
		props: raw.props,
		...(scope !== undefined ? { scope } : {}),
		...(timezone !== undefined ? { timezone } : {}),
	}
}
