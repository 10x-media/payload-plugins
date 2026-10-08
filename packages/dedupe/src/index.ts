import { type Config, definePlugin } from 'payload'

import { type DedupePluginOptions, type ResolvedOptions, resolveOptions } from './options'
import { type Adapters, buildContext, CONTEXT_SOURCE } from './plugin/context'
import { registerCollections } from './plugin/registerCollections'
import { registerEndpoints } from './plugin/registerEndpoints'
import { registerHooks } from './plugin/registerHooks'
import { registerJobs } from './plugin/registerJobs'
import { registerTranslations } from './plugin/registerTranslations'
import { registerViews } from './plugin/registerViews'
import type { DedupeAdapter } from './search/contract'
import { keysAdapter } from './search/keysAdapter'

export { presets as comparePresets } from './match/presets'
export { readPath } from './merge/compare'
export type { DedupePluginOptions } from './options'
export { matchFields, tenantOf } from './plugin/context'
export type { DedupeEvent, DedupeEventSink } from './plugin/events'
export type { Duplicate } from './queue/live'
export { findDuplicates } from './queue/live'
export type { DedupeFieldConfig } from './schema/fieldConfig'
export { DEDUPE_FIELD_KEY, dedupeCustom } from './schema/fieldConfig'

/**
 * The plugin's adapter, built on the keys adapter, and each collection's own, built on the
 * plugin's. A collection's adapter is used whole: a method it lacks is not taken from the
 * plugin's, which works over another index.
 */
const resolveAdapters = (resolved: ResolvedOptions, keys: DedupeAdapter): Adapters => {
	const checked = (adapter: DedupeAdapter, of: string) => {
		if (typeof adapter?.findCandidates !== 'function') {
			throw new Error(`dedupe: the adapter${of} has no \`findCandidates\``)
		}
		return adapter
	}
	const plugin = checked(resolved.adapter ? resolved.adapter(keys) : keys, '')
	const own = new Map<string, DedupeAdapter>()
	for (const entry of resolved.collections) {
		if (entry.adapter) own.set(entry.slug, checked(entry.adapter(plugin), ` of "${entry.slug}"`))
	}
	return { plugin, own }
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/dedupe': DedupePluginOptions
	}
}

/**
 * Finds duplicate documents in the configured collections and merges a group of them into
 * one from the admin. Search and merge are independent: a collection without a `match`
 * config still gets the manual merge of documents picked by hand.
 */
export const dedupe = definePlugin<DedupePluginOptions>({
	slug: '@10x-media/dedupe',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		const resolved = resolveOptions(options)
		const keys = keysAdapter({
			read: resolved.collectionAccess.read,
			override: resolved.overrides.keys,
		})
		const adapters = resolveAdapters(resolved, keys)

		registerCollections(config, resolved)
		// An adapter spread from another shares its `register`, which must add its collection once.
		const registered = new Set<DedupeAdapter['register']>()
		for (const adapter of [adapters.plugin, ...adapters.own.values()]) {
			if (!adapter.register || registered.has(adapter.register)) continue
			registered.add(adapter.register)
			adapter.register(config)
		}
		if (options.disabled === true) {
			config.custom = { ...config.custom, [CONTEXT_SOURCE]: null }
			return config
		}
		config.custom = { ...config.custom, [CONTEXT_SOURCE]: { options: resolved, adapters } }
		registerTranslations(config, resolved.translations)
		registerHooks(config, resolved)
		registerEndpoints(config, resolved)
		registerJobs(config, resolved)
		registerViews(config, resolved)

		// The merge spec needs the sanitized schema, which only exists once Payload has
		// booted, so every configured path is validated here rather than at config time.
		const previousOnInit = config.onInit
		config.onInit = async (payload) => {
			buildContext(payload, resolved, adapters)
			if (previousOnInit) await previousOnInit(payload)
		}
		return config
	},
})

export type { DedupePluginOptions as PluginOptions }
