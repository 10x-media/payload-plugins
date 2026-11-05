import { createHash } from 'node:crypto'
import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { AnalyticsFilter, AnalyticsQuery } from './contract'
import { canonicalJson } from './values'

/**
 * Written into every key. Bump it when the key layout or what a metric means changes, so no entry
 * written under the old meaning is ever read.
 */
const CACHE_KEY_VERSION = 3

/** The two tokens a cached read is keyed on; a new value of either retires it on every instance. */
export interface CacheKeyEpochs {
	/** The scope's provider and goal configuration. */
	config: string
	/** The scope's manual refresh token. */
	refresh: string
}

/**
 * A live window snaps to whole days so renders within a day share an entry; a closed one keys on
 * exact bounds, or two windows differing inside their last day would share one.
 */
const windowOf = (range: AnalyticsQuery['dateRange'], tz: string): string => {
	const nextDay = addDaysInTz(range.end, 1, tz)
	if (nextDay.getTime() - 1 === range.end.getTime()) {
		return `${range.start.toISOString()}_${range.end.toISOString()}`
	}
	return `${startOfDayInTz(range.start, tz).toISOString()}_${nextDay.toISOString()}`
}

/** A set, sorted and without repeats; an empty one keys like an absent one, asking the same. */
const setOf = <T extends string>(values: readonly T[] | undefined): T[] | undefined =>
	values && values.length > 0 ? [...new Set(values)].sort() : undefined

const filtersOf = (filters: readonly AnalyticsFilter[] | undefined): string[] | undefined =>
	setOf(filters?.map((filter) => canonicalJson(filter)))

/**
 * The query as keyed: every field it carries, so a later field is never left out, with the window
 * snapped and sets sorted. `'unresolved'` stays a string, apart from a goal of that name.
 */
export const keyedQuery = (q: AnalyticsQuery): Record<string, unknown> => {
	const { dateRange, ...rest } = q
	const timezone = q.timezone ?? DEFAULT_TIMEZONE
	return {
		...rest,
		window: windowOf(dateRange, timezone),
		timezone,
		metrics: setOf(q.metrics),
		dimensions: setOf(q.dimensions),
		filters: filtersOf(q.filters),
		goalSlugs: q.goalSlugs === 'unresolved' ? q.goalSlugs : setOf(q.goalSlugs),
	}
}

const hashed = (prefix: string, value: unknown): string =>
	`${prefix}${createHash('sha256').update(canonicalJson(value)).digest('base64url')}`

/**
 * `r:` plus the base64url SHA-256 of the canonical key fields: fixed length, and no value can be
 * spelled to look like another field.
 */
export const buildCacheKey = (source: string, q: AnalyticsQuery, epochs: CacheKeyEpochs): string =>
	hashed('r:', {
		v: CACHE_KEY_VERSION,
		source,
		configEpoch: epochs.config,
		refreshEpoch: epochs.refresh,
		q: keyedQuery(q),
	})

/** What a live count is keyed on; its window always ends now, so it carries a length instead. */
interface RealtimeKeyParts {
	metric: string
	windowMinutes: number
	scope?: string
	path?: string
	series: boolean
}

/** `rt:` and the same digest over a live count's parts; such a key is only ever held in memory. */
export const buildRealtimeKey = (
	source: string,
	parts: RealtimeKeyParts,
	epochs: CacheKeyEpochs
): string =>
	hashed('rt:', {
		v: CACHE_KEY_VERSION,
		source,
		configEpoch: epochs.config,
		refreshEpoch: epochs.refresh,
		parts,
	})
