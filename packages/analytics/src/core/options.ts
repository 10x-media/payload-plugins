import type { AnalyticsBinding, ResolvedBinding } from '../binding/types'
import type { CustomWidgetDef } from '../widgets/customWidget'
import type { AnalyticsAdapter } from './contract'

const DEFAULT_WARM_CRON = '*/30 * * * *'
const DEFAULT_SYNC_CRON = '0 */6 * * *'
const DEFAULT_SYNC_COLLECTION = 'analytics-daily'
const DEFAULT_SYNC_LOOKBACK = 3

export type AnalyticsPluginOptions = {
	disabled?: boolean
	adapters?: AnalyticsAdapter[]
	defaultAdapter?: string
	collections?: Record<string, AnalyticsBinding>
	cache?: { ttl?: { aggregate?: number; realtime?: number }; warm?: boolean | { cron?: string } }
	widgets?: boolean | { disabled?: string[]; register?: CustomWidgetDef[] }
	/**
	 * Opt-in sync tier: a cron job that persists each provider's daily metrics into a
	 * queryable collection. Reads go through the surfacing cache, so persisted rows reflect
	 * cached values up to `cache.ttl.aggregate` old; keep that TTL below the sync interval
	 * for the freshest data.
	 */
	sync?:
		| boolean
		| { collectionSlug?: string; cron?: string; lookbackDays?: number; adapters?: string[] }
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	bindings: Record<string, ResolvedBinding>
	cache: { ttl: { aggregate: number; realtime: number }; warm: { enabled: boolean; cron: string } }
	widgets: { enabled: boolean; disabled: string[]; register: CustomWidgetDef[] }
	sync: {
		enabled: boolean
		collectionSlug: string
		cron: string
		lookbackDays: number
		adapters?: string[]
	}
}

const resolveBindings = (
	collections: AnalyticsPluginOptions['collections']
): Record<string, ResolvedBinding> => {
	const out: Record<string, ResolvedBinding> = {}
	for (const [slug, binding] of Object.entries(collections ?? {})) {
		if (!binding.path && !binding.pathField) {
			throw new Error(`analytics: binding for "${slug}" needs a path resolver or a pathField`)
		}
		out[slug] = binding
	}
	return out
}

export function resolveOptions(options: AnalyticsPluginOptions): ResolvedOptions {
	if (!options.adapters || options.adapters.length === 0) {
		throw new Error('analytics: at least one adapter is required')
	}
	const widgets =
		options.widgets === false
			? { enabled: false, disabled: [] as string[], register: [] as CustomWidgetDef[] }
			: options.widgets === undefined || options.widgets === true
				? { enabled: true, disabled: [] as string[], register: [] as CustomWidgetDef[] }
				: {
						enabled: true,
						disabled: options.widgets.disabled ?? [],
						register: options.widgets.register ?? [],
					}
	const warmOpt = options.cache?.warm
	const warm =
		warmOpt === true
			? { enabled: true, cron: DEFAULT_WARM_CRON }
			: warmOpt && typeof warmOpt === 'object'
				? { enabled: true, cron: warmOpt.cron ?? DEFAULT_WARM_CRON }
				: { enabled: false, cron: DEFAULT_WARM_CRON }
	const syncOpt = options.sync
	const sync =
		syncOpt === true
			? {
					enabled: true,
					collectionSlug: DEFAULT_SYNC_COLLECTION,
					cron: DEFAULT_SYNC_CRON,
					lookbackDays: DEFAULT_SYNC_LOOKBACK,
				}
			: syncOpt && typeof syncOpt === 'object'
				? {
						enabled: true,
						collectionSlug: syncOpt.collectionSlug ?? DEFAULT_SYNC_COLLECTION,
						cron: syncOpt.cron ?? DEFAULT_SYNC_CRON,
						lookbackDays: syncOpt.lookbackDays ?? DEFAULT_SYNC_LOOKBACK,
						adapters: syncOpt.adapters,
					}
				: {
						enabled: false,
						collectionSlug: DEFAULT_SYNC_COLLECTION,
						cron: DEFAULT_SYNC_CRON,
						lookbackDays: DEFAULT_SYNC_LOOKBACK,
					}
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		bindings: resolveBindings(options.collections),
		cache: {
			ttl: {
				aggregate: options.cache?.ttl?.aggregate ?? 3600,
				realtime: options.cache?.ttl?.realtime ?? 300,
			},
			warm,
		},
		widgets,
		sync,
	}
}
