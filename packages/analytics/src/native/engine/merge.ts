import { addParts, type MetricParts } from '../store/parts'
import { compareRows } from '../store/rawRead'
import type { RawOrder } from '../store/types'

/** One value of a breakdown and its parts. */
export interface ValueRow {
	value: string
	parts: MetricParts
}

/** What a side answered for a ranking: its rows, and whether they are all it has. */
export interface SideRanking {
	rows: ValueRow[]
	/** It answered fewer rows than asked for, so no value is left beyond them. */
	complete: boolean
}

/** One part of a breakdown's range that ranks its own values: aggregated days, or a raw window. */
export interface RankedSide {
	/** Its first `limit` values by the read's order, or every value without a limit. */
	top(limit: number | undefined): Promise<SideRanking>
	/** Its parts of exactly these values; a value it has no row for is left out. */
	fill(values: readonly string[]): Promise<ValueRow[]>
}

/**
 * Candidates each side offers beyond the limit, so a value ranked a little lower on every side
 * can still make the cut once the sides are added up.
 */
export const CANDIDATE_HEADROOM = 50

/** Adds `parts` to the sum `sums` holds under `key`, starting one when it holds none. */
export const addInto = <K>(sums: Map<K, MetricParts>, key: K, parts: MetricParts): void => {
	const sum = sums.get(key)
	sums.set(key, sum ? addParts(sum, parts) : parts)
}

/** Rows of the same value added up, in first-seen order. */
export const sumByValue = (rows: Iterable<ValueRow>): ValueRow[] => {
	const sums = new Map<string, MetricParts>()
	for (const row of rows) {
		addInto(sums, row.value, row.parts)
	}
	return [...sums].map(([value, parts]) => ({ value, parts }))
}

/** Rows in the order every store answers in: by rank, nothing to rank last, then by value. */
export const ranked = (rows: readonly ValueRow[], order: RawOrder): ValueRow[] =>
	[...rows].sort(compareRows(order))

/**
 * The first `limit` values across every side: each offers `limit + 50`, fills in the others' offers
 * exactly, and the sums are ranked again. A value missing from every offer is never considered.
 */
export const topAcross = async (
	sides: readonly RankedSide[],
	order: RawOrder,
	limit: number | undefined
): Promise<ValueRow[]> => {
	const [only] = sides
	if (sides.length === 1 && only) {
		return (await only.top(limit)).rows
	}
	const asked = limit === undefined ? undefined : limit + CANDIDATE_HEADROOM
	const offers = await Promise.all(sides.map((side) => side.top(asked)))
	const candidates = new Set(offers.flatMap((offer) => offer.rows.map((row) => row.value)))
	const filled = await Promise.all(
		sides.map(async (side, index) => {
			const offer = offers[index]
			if (!offer || offer.complete) {
				return offer?.rows ?? []
			}
			const offered = new Set(offer.rows.map((row) => row.value))
			const missing = [...candidates].filter((value) => !offered.has(value))
			return missing.length === 0 ? offer.rows : [...offer.rows, ...(await side.fill(missing))]
		})
	)
	const merged = ranked(sumByValue(filled.flat()), order)
	return limit === undefined ? merged : merged.slice(0, limit)
}
