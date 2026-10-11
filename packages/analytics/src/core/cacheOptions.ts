import { CACHE_SLUG } from '../surfacing/cacheCollection'
import { isCacheStore } from '../surfacing/cacheStore'
import { DEFAULT_COLD_READS_PER_SCOPE } from '../surfacing/coldBudget'
import { DEFAULT_GLOBAL_CONCURRENCY, DEFAULT_SOURCE_CONCURRENCY } from '../surfacing/lanes'
import { SYNC_SLUG } from '../sync/collection'
import { resolveCollectionOption } from './collectionOption'
import {
	keysOf,
	optionalBoolean,
	optionalFunction,
	optionalList,
	optionalSeconds,
	optionsObject,
	positiveWhole,
} from './optionChecks'
import type {
	AnalyticsCacheOptions,
	AnalyticsConcurrencyOptions,
	AnalyticsHooksOptions,
	AnalyticsPluginOptions,
	AnalyticsSyncOptions,
	AnalyticsWarmOptions,
	ResolvedOptions,
} from './options'
import { kindOf } from './values'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_WARM_WINDOW_HOURS = 24
const DEFAULT_WARM_MAX_READS = 200
const DEFAULT_SYNC_LOOKBACK = 3

const CACHE_KEYS = keysOf<AnalyticsCacheOptions>({
	ttl: true,
	warm: true,
	timeoutMs: true,
	concurrency: true,
	store: true,
	collection: true,
})
const TTL_KEYS = keysOf<NonNullable<AnalyticsCacheOptions['ttl']>>({
	aggregate: true,
	realtime: true,
})
const CONCURRENCY_KEYS = keysOf<AnalyticsConcurrencyOptions>({
	global: true,
	perSource: true,
	perScope: true,
})
const WARM_KEYS = keysOf<AnalyticsWarmOptions>({ windowHours: true, maxReads: true })
const SYNC_KEYS = keysOf<AnalyticsSyncOptions>({
	lookbackDays: true,
	adapters: true,
	collection: true,
})
const HOOKS_KEYS = keysOf<AnalyticsHooksOptions>({ afterRead: true })

type ResolvedCache = ResolvedOptions['cache']

const resolveWarm = (option: AnalyticsCacheOptions['warm']): ResolvedCache['warm'] => {
	const defaults = { windowHours: DEFAULT_WARM_WINDOW_HOURS, maxReads: DEFAULT_WARM_MAX_READS }
	if (option === undefined || option === false) {
		return { enabled: false, ...defaults }
	}
	if (option === true) {
		return { enabled: true, ...defaults }
	}
	optionsObject(option, {
		path: 'cache.warm',
		known: WARM_KEYS,
		example: 'true, false or an object such as { windowHours: 24 }',
	})
	return {
		enabled: true,
		windowHours: positiveWhole(option.windowHours, 'cache.warm.windowHours', defaults.windowHours),
		maxReads: positiveWhole(option.maxReads, 'cache.warm.maxReads', defaults.maxReads),
	}
}

const resolveConcurrency = (
	option: AnalyticsConcurrencyOptions | undefined
): ResolvedCache['concurrency'] => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'cache.concurrency',
			known: CONCURRENCY_KEYS,
			example: 'an object such as { perSource: 4 }',
		})
	}
	return {
		global: positiveWhole(option?.global, 'cache.concurrency.global', DEFAULT_GLOBAL_CONCURRENCY),
		perSource: positiveWhole(
			option?.perSource,
			'cache.concurrency.perSource',
			DEFAULT_SOURCE_CONCURRENCY
		),
		perScope: positiveWhole(
			option?.perScope,
			'cache.concurrency.perScope',
			DEFAULT_COLD_READS_PER_SCOPE
		),
	}
}

/** The host's store, or the `analytics-cache` collection it replaces: never both. */
const resolveCacheStorage = (
	option: AnalyticsCacheOptions | undefined
): Pick<ResolvedCache, 'store' | 'collection'> => {
	const store: unknown = option?.store
	const collection = option?.collection
	if (store !== undefined && !isCacheStore(store)) {
		throw new Error(
			`analytics: cache.store must be an object with get, set, touch, sweep and recentRecipes methods, got ${kindOf(store)}`
		)
	}
	if (store !== undefined && collection !== undefined) {
		throw new Error(
			'analytics: cache.collection shapes the analytics-cache collection, which cache.store replaces; set one of them'
		)
	}
	return {
		...(store === undefined ? {} : { store }),
		collection: resolveCollectionOption(collection, {
			path: 'cache.collection',
			fallback: CACHE_SLUG,
		}),
	}
}

/** `cache`: TTLs, warming, the source deadline, concurrency and where reads are stored. */
export const resolveCache = (option: AnalyticsCacheOptions | undefined): ResolvedCache => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'cache',
			known: CACHE_KEYS,
			example: 'an object such as { timeoutMs: 15000 }',
		})
		if (option.ttl !== undefined) {
			optionsObject(option.ttl, {
				path: 'cache.ttl',
				known: TTL_KEYS,
				example: 'an object such as { aggregate: 300 }',
			})
		}
	}
	return {
		ttl: {
			aggregate: optionalSeconds(option?.ttl?.aggregate, 'cache.ttl.aggregate'),
			realtime: optionalSeconds(option?.ttl?.realtime, 'cache.ttl.realtime'),
		},
		warm: resolveWarm(option?.warm),
		timeoutMs: positiveWhole(option?.timeoutMs, 'cache.timeoutMs', DEFAULT_TIMEOUT_MS),
		concurrency: resolveConcurrency(option?.concurrency),
		...resolveCacheStorage(option),
	}
}

/** `sync`: off unless set; `true` copies every vendor source with the defaults. */
export const resolveSync = (option: AnalyticsPluginOptions['sync']): ResolvedOptions['sync'] => {
	const off: ResolvedOptions['sync'] = {
		enabled: false,
		lookbackDays: DEFAULT_SYNC_LOOKBACK,
		collection: { slug: SYNC_SLUG, hidden: true },
	}
	if (!option) {
		return off
	}
	if (option === true) {
		return { ...off, enabled: true }
	}
	const shaped = optionsObject(option, {
		path: 'sync',
		known: SYNC_KEYS,
		example: 'true, or an object such as { lookbackDays: 3 }',
	})
	for (const entry of optionalList(shaped.adapters, 'sync.adapters', "['plausible']")) {
		if (typeof entry !== 'string' || entry.trim() === '') {
			throw new Error(
				`analytics: sync.adapters entries must each be an adapter id or a provider type, got ${kindOf(entry)}`
			)
		}
	}
	optionalBoolean(option.collection?.hidden, 'sync.collection.hidden')
	const collection = resolveCollectionOption(option.collection, {
		path: 'sync.collection',
		fallback: SYNC_SLUG,
		extra: ['hidden'],
	})
	return {
		enabled: true,
		lookbackDays: positiveWhole(option.lookbackDays, 'sync.lookbackDays', DEFAULT_SYNC_LOOKBACK),
		...(option.adapters ? { adapters: option.adapters } : {}),
		collection: { ...collection, hidden: option.collection?.hidden ?? true },
	}
}

/** `hooks`: functions the plugin calls around what it does. */
export const resolveHooks = (
	option: AnalyticsHooksOptions | undefined
): ResolvedOptions['hooks'] => {
	if (option === undefined) {
		return {}
	}
	optionsObject(option, {
		path: 'hooks',
		known: HOOKS_KEYS,
		example: 'an object such as { afterRead }',
	})
	const afterRead = optionalFunction(option.afterRead, 'hooks.afterRead')
	return afterRead ? { afterRead } : {}
}
