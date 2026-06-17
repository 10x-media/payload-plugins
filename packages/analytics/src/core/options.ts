import type { AnalyticsBinding, ResolvedBinding } from '../binding/types'
import type { AnalyticsAdapter } from './contract'

export type AnalyticsPluginOptions = {
	disabled?: boolean
	adapters?: AnalyticsAdapter[]
	defaultAdapter?: string
	collections?: Record<string, AnalyticsBinding>
	cache?: { ttl?: { aggregate?: number; realtime?: number } }
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	bindings: Record<string, ResolvedBinding>
	cache: { ttl: { aggregate: number; realtime: number } }
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
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		bindings: resolveBindings(options.collections),
		cache: {
			ttl: {
				aggregate: options.cache?.ttl?.aggregate ?? 3600,
				realtime: options.cache?.ttl?.realtime ?? 300,
			},
		},
	}
}
