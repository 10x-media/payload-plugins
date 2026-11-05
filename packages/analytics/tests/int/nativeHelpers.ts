import type { Payload, Where } from 'payload'
import { HITS_SLUG } from '../../src/native/collections/slugs'
import { type NativeInstance, nativeInstanceOf } from '../../src/native/engine/instance'
import { toHit } from '../../src/native/engine/toHit'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { ulid } from '../../src/native/store/ids'
import type { AppendResult, HitRow } from '../../src/native/store/types'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { ingestRequest } from './ingestRequest'

/** The native engine an instance's runtime built for it at boot. */
export const nativeOf = (payload: Payload): NativeInstance => {
	const instance = nativeInstanceOf(payload)
	if (!instance) {
		throw new Error('the runtime attaches the native adapter to every instance at boot')
	}
	return instance
}

/** A stored hit as Payload's adapter reads it back: dates as ISO text, absent fields as null. */
export type StoredHit = Record<string, unknown>

/** The stored hits `where` selects, oldest first; a ULID breaks a tie within one millisecond. */
export const storedHits = async (payload: Payload, where: Where = {}): Promise<StoredHit[]> =>
	(
		await payload.find({
			collection: HITS_SLUG,
			where,
			pagination: false,
			sort: ['ts', 'id'],
			depth: 0,
		})
	).docs

export const countHits = async (payload: Payload, where: Where = {}): Promise<number> =>
	(await payload.count({ collection: HITS_SLUG, where })).totalDocs

/**
 * A beacon taken by the ingest endpoint the native adapter registered under the default base,
 * as the router would hand it over.
 */
export const postBeacon = async (
	payload: Payload,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): Promise<Response> => {
	const path = routePaths(DEFAULT_ROUTE_BASE).ingest
	const endpoint = payload.config.endpoints?.find(
		(each) => each.method === 'post' && each.path === path
	)
	if (!endpoint) {
		throw new Error(`no ingest endpoint is mounted at ${path}`)
	}
	return endpoint.handler(ingestRequest(payload, body, headers))
}

/**
 * A beacon taken by a native ingest handler built with its defaults alone: none of the resolvers or
 * attribution options the install's mounted endpoint carries.
 */
export const ingestDirect = async (
	payload: Payload,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): Promise<Response> =>
	makeIngestHandler({ geoResolver: platformHeaderResolver, target: nativeOf })(
		ingestRequest(payload, body, headers)
	)

/** Stores events as ingest leaves them, each received at its own timestamp. */
export const storeEvents = (
	payload: Payload,
	events: readonly NormalizedEvent[]
): Promise<AppendResult> =>
	nativeOf(payload).store.append(
		events.map((event) => toHit(event, { receivedAt: event.timestamp }))
	)

/** A landing pageview at `ts` by visitor `v`: the row one beacon leaves in the store. */
export const pageviewHit = (args: {
	ts: Date
	v: string
	path?: string
	hostname?: string
	scope?: string
}): HitRow => ({
	id: ulid(args.ts),
	scope: args.scope ?? '',
	ts: args.ts,
	type: 'pageview',
	hostname: args.hostname ?? 'h',
	path: args.path ?? '/p',
	v: args.v,
	landing: true,
	server: false,
})

/** The day before now through a minute ahead: a read window around what a test just stored. */
export const aroundNow = (): { start: Date; end: Date } => {
	const now = Date.now()
	return { start: new Date(now - 86_400_000), end: new Date(now + 60_000) }
}
