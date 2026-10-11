import { serverTwinOf, wireTwinOf } from './ids'
import type { HitRow } from './types'

/**
 * Hits one statement writes, on every database: a row binds at most 40 values, which keeps a
 * chunk well under the 32,766 parameters SQLite allows.
 */
export const HIT_CHUNK = 500

/** The sale a hit records, which the server's record of an order hands to the browser's. */
export const SALE_FIELDS: ReadonlyArray<keyof HitRow> = [
	'conversions',
	'revenue',
	'goals',
	'value',
	'originalValue',
	'currency',
	'originalCurrency',
]

/**
 * How far apart an order's browser and server records may lie to count as one sale: a checkout
 * lasts at most a day, and a record forged ahead of a guessed order id must land inside it.
 */
export const TWIN_WINDOW_MS = 86_400_000

/** Whether two records of one order are close enough in time to be counted as one sale. */
export const twinsWithin = (a: Date, b: Date, windowMs: number | null): boolean =>
	windowMs === null || Math.abs(a.getTime() - b.getTime()) <= windowMs

/** Every sale field left out: the browser's record of an order whose sale the server records. */
const withoutSale = (wire: HitRow): HitRow => {
	const counted = { ...wire }
	for (const field of SALE_FIELDS) {
		Reflect.deleteProperty(counted, field)
	}
	return counted
}

/**
 * The browser's record of an order, carrying the server's sale in place of its own, and the
 * server's item when it names one. That item came from no page, so it lands on none (`server`).
 */
const credited = (wire: HitRow, server: HitRow): HitRow => {
	const counted = withoutSale(wire)
	for (const field of SALE_FIELDS) {
		const value = server[field]
		if (value !== undefined) {
			Reflect.set(counted, field, value)
		}
	}
	return server.item === undefined ? counted : { ...counted, item: server.item, server: true }
}

/**
 * A hit as reads and aggregation count it. An order both sides recorded within `windowMs` is one
 * sale on the browser's record, the server's null; further apart, only the server's keeps a sale.
 */
export const countedHit = (
	hit: HitRow,
	stored: ReadonlyMap<string, HitRow>,
	windowMs: number | null
): HitRow | null => {
	const server = serverTwinOf(hit.id)
	if (server !== undefined) {
		const twin = stored.get(server)
		if (twin === undefined) {
			return hit
		}
		return twinsWithin(hit.ts, twin.ts, windowMs) ? credited(hit, twin) : withoutSale(hit)
	}
	const wire = wireTwinOf(hit.id)
	const twin = wire === undefined ? undefined : stored.get(wire)
	return twin !== undefined && twinsWithin(hit.ts, twin.ts, windowMs) ? null : hit
}

/** Every hit as {@link countedHit} counts it, the server's records of orders credited left out. */
export const countedHits = (hits: readonly HitRow[], windowMs: number | null): HitRow[] => {
	const stored = new Map(hits.map((hit) => [hit.id, hit]))
	return hits.flatMap((hit) => {
		const counted = countedHit(hit, stored, windowMs)
		return counted === null ? [] : [counted]
	})
}

/** A call's hits with each id once, the first of a repeated id kept, and how many were left out. */
export const distinctHits = (hits: readonly HitRow[]): { unique: HitRow[]; repeated: number } => {
	const seen = new Set<string>()
	const unique: HitRow[] = []
	for (const hit of hits) {
		if (!seen.has(hit.id)) {
			seen.add(hit.id)
			unique.push(hit)
		}
	}
	return { unique, repeated: hits.length - unique.length }
}

/**
 * Fields a tombstone clears from an order's record past raw retention (`v` emptied too); its key,
 * scope, time and sale stay, so the order's other record still finds it and counts as it did.
 */
export const TOMBSTONE_CLEARED: ReadonlyArray<keyof HitRow> = [
	'lastAt',
	'ref',
	'source',
	'channel',
	'channelVersion',
	'clickId',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmContent',
	'utmTerm',
	'country',
	'region',
	'city',
	'language',
	'device',
	'browser',
	'os',
	'durationMs',
	'scrollDepth',
	'props',
	'impressions',
]

/** An order's record as a tombstone: see {@link TOMBSTONE_CLEARED}. */
export const tombstoneOf = (hit: HitRow): HitRow => {
	const kept: HitRow = { ...hit, v: '' }
	for (const field of TOMBSTONE_CLEARED) {
		Reflect.deleteProperty(kept, field)
	}
	return kept
}

/** Whether an order's record still holds anything a tombstone clears. */
export const holdsVisit = (hit: HitRow): boolean =>
	hit.v !== '' || TOMBSTONE_CLEARED.some((field) => hit[field] !== undefined)
