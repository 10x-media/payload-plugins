import type { AnalyticsAdapter } from './contract'

export type AnalyticsPluginOptions = {
	disabled?: boolean
	adapters?: AnalyticsAdapter[]
	defaultAdapter?: string
	cache?: { ttl?: { aggregate?: number; realtime?: number } }
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	cache: { ttl: { aggregate: number; realtime: number } }
}

export function resolveOptions(options: AnalyticsPluginOptions): ResolvedOptions {
	if (!options.adapters || options.adapters.length === 0) {
		throw new Error('analytics: at least one adapter is required')
	}
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		cache: {
			ttl: {
				aggregate: options.cache?.ttl?.aggregate ?? 3600,
				realtime: options.cache?.ttl?.realtime ?? 300,
			},
		},
	}
}
