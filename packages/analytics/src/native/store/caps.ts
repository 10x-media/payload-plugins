import { isRecord, kindOf } from '../../core/values'
import { type MetricParts, sumParts } from './parts'
import { compareCodePoints, type SessionDimension } from './rawRead'

/**
 * What a cap bounds: one dimension's rows, the goal pairs (one goal's channels, sources or
 * campaigns, each kind capped on its own), or the item by page rows (one item's pages).
 */
export type CapKey =
	| SessionDimension
	| 'page'
	| 'event'
	| 'goal'
	| 'currency'
	| 'item'
	| 'goalPairs'
	| 'itemPages'

/**
 * How many values a kind keeps per scope, local day and hostname, and for a pair per first value
 * too (each goal, each item); null keeps every one.
 */
export type CardinalityCaps = Readonly<Record<CapKey, number | null>>

/** `native({ caps })`: the caps to change, by kind; null lifts one. */
export type CapsOption = Partial<Record<CapKey, number | null>>

/**
 * A ceiling where whoever sends a beacon picks the values (pages, currencies), tight where a long
 * tail is noise, none where config, signing or a fixed list bounds them (goals, items, countries).
 */
export const DEFAULT_CAPS: CardinalityCaps = {
	page: 10_000,
	referrer: 500,
	source: 500,
	city: 500,
	region: 300,
	utmSource: 300,
	utmMedium: 300,
	utmCampaign: 300,
	utmContent: 300,
	utmTerm: 300,
	event: 300,
	goalPairs: 300,
	item: null,
	itemPages: 2000,
	language: 200,
	goal: null,
	country: null,
	device: null,
	browser: null,
	os: null,
	channel: null,
	currency: 100,
}

const isCapKey = (key: string): key is CapKey => Object.hasOwn(DEFAULT_CAPS, key)

/** The caps `native({ caps })` sets over the defaults; each a whole count or null, or it throws. */
export const resolveCaps = (option: unknown): CardinalityCaps => {
	if (option === undefined) {
		return DEFAULT_CAPS
	}
	if (!isRecord(option) || Array.isArray(option)) {
		throw new Error(
			`analytics: native caps must be an object of caps by kind, got ${kindOf(option)}`
		)
	}
	const caps: Record<CapKey, number | null> = { ...DEFAULT_CAPS }
	for (const [key, value] of Object.entries(option)) {
		if (!isCapKey(key)) {
			throw new Error(
				`analytics: native caps has no "${key}"; it caps ${Object.keys(DEFAULT_CAPS).join(', ')}`
			)
		}
		if (value === undefined) {
			continue
		}
		if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) {
			throw new Error(
				`analytics: native caps.${key} must be a whole number of at least 1, or null for no cap, got ${typeof value === 'number' ? value : kindOf(value)}`
			)
		}
		caps[key] = value
	}
	return caps
}

/**
 * What an `(other)` row carries: in `value` for a dimension, in `value2` for a pair, whose
 * `(other)` row keeps its first value (the goal, the item) in `value`.
 */
export const OTHER_VALUE = ''

/** A row of one kind on one hostname, as capping sees it. */
export interface CappableRow {
	hostname: string
	value: string
	value2: string
	parts: MetricParts
}

/**
 * Most viewed first (pageviews, or an item's views, which counts no pageviews), then most events,
 * then by value and second value in code point order, so every store keeps the same rows.
 */
export const compareByRank = (a: CappableRow, b: CappableRow): number => {
	const views =
		(b.parts.pageviews ?? b.parts.impressions ?? 0) -
		(a.parts.pageviews ?? a.parts.impressions ?? 0)
	if (views !== 0) {
		return views
	}
	const events = (b.parts.events ?? 0) - (a.parts.events ?? 0)
	if (events !== 0) {
		return events
	}
	return compareCodePoints(a.value, b.value) || compareCodePoints(a.value2, b.value2)
}

/**
 * What an `(other)` row leaves unknown: one visitor or visit can sit in several of the rows folded
 * together, and visit time goes with the visits it belongs to.
 */
export const UNKNOWN_WHEN_FOLDED: ReadonlyArray<keyof MetricParts> = [
	'visitors',
	'sessions',
	'sessionMs',
]

/** The tail's parts as one row: what adds up is summed, the rest left unknown. */
export const foldParts = (rows: readonly CappableRow[]): MetricParts => {
	const parts = sumParts(rows.map((row) => row.parts))
	for (const part of UNKNOWN_WHEN_FOLDED) {
		parts[part] = null
	}
	return parts
}
