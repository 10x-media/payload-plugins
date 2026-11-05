import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { hasMethods, isRecord } from '../core/values'
import { isTimeframePreset, type TimeframePreset } from '../timeframe/presets'
import { isRecipeWindow } from './recipe'

/** How long past its expiry an entry is still served, stale, while a refresh runs. */
export const STALE_WINDOW_SECONDS = 86_400

/**
 * Which window of its timeframe a recipe's read covered: up to the read (`live`), the preset's
 * whole calendar days (`days`), or as many days before it (`previous`, a comparison).
 */
export type RecipeWindow = 'live' | 'days' | 'previous'

/**
 * What it takes to repeat a reader's read: source, scope, timeframe and window, and the query
 * without its window, which is worked out again on each repeat.
 */
export interface ReadRecipe {
	/** The source's adapter id, as the scope's sources list it. */
	adapterRef: string
	scope: string | null
	timeframe: TimeframePreset
	window: RecipeWindow
	query: Omit<AnalyticsQuery, 'dateRange'>
}

/** One cached read. Instants are epoch milliseconds. */
export interface CacheEntry {
	value: AnalyticsResult
	/** When the value was fetched from its source. */
	fetchedAt: number
	/** Until when the value is fresh. */
	expiresAt: number
	/** Until when it is served at all: stale past `expiresAt`, while a refresh runs. */
	staleUntil: number
	/** When a read carrying a recipe last asked for it; null or absent when none did. */
	readAt?: number | null
}

export interface CacheSetOptions {
	/** Seconds the value is fresh, from now. */
	ttlSeconds: number
	/** Seconds past that it may still be served stale. */
	staleSeconds: number
	/** The scope the read was made for, absent for an install-wide read. */
	scope?: string
	/**
	 * Present when a reader's read can be repeated by the warm task; the entry then counts as read
	 * now. The warm task's own writes carry none, which leaves the entry's recipe and read time be.
	 */
	recipe?: ReadRecipe
}

/**
 * Where reads are cached across instances (`cache.store`; built in: `analytics-cache`). Every call
 * is best effort: a throw makes a hit a miss and a write nothing, and never fails the read.
 */
export interface CacheStore {
	/** The entry under `key`; null when there is none or it is past its `staleUntil`. */
	get(key: string): Promise<CacheEntry | null>
	/** Stores `value` under `key`, replacing any entry, stamped with the store's own clock. */
	set(key: string, value: AnalyticsResult, options: CacheSetOptions): Promise<void>
	/**
	 * Records that a read carrying `recipe` asked for the entry at `at`, storing the recipe with it
	 * when given: an entry the warm task wrote has none until a reader asks for it.
	 */
	touch(key: string, at: Date, recipe?: ReadRecipe): Promise<void>
	/**
	 * Deletes at most `batch` entries whose `staleUntil` is before `now` and answers how many. A
	 * store that expires entries itself answers 0.
	 */
	sweep(now: Date, batch: number): Promise<number>
	/** The recipes of entries read since `since`, most recently read first, each once. */
	recentRecipes(since: Date, limit: number): Promise<ReadRecipe[]>
}

const CACHE_STORE_METHODS = ['get', 'set', 'touch', 'sweep', 'recentRecipes'] as const

export const isCacheStore = (value: unknown): value is CacheStore =>
	hasMethods(value, CACHE_STORE_METHODS)

/** Whether a stored value still has the shape of a read result; anything else reads as a miss. */
export const isCachedResult = (value: unknown): value is AnalyticsResult =>
	isRecord(value) &&
	Array.isArray(value.rows) &&
	isRecord(value.meta) &&
	typeof value.meta.provider === 'string' &&
	typeof value.meta.fetchedAt === 'string'

export const isReadRecipe = (value: unknown): value is ReadRecipe =>
	isRecord(value) &&
	typeof value.adapterRef === 'string' &&
	(value.scope === null || typeof value.scope === 'string') &&
	isTimeframePreset(value.timeframe) &&
	isRecipeWindow(value.window) &&
	isRecord(value.query) &&
	Array.isArray(value.query.metrics)
