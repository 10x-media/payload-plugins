import { type Config, definePlugin } from 'payload'

import { type DedupePluginOptions, resolveOptions } from './options'
import { buildContext, CONTEXT_SOURCE } from './plugin/context'
import { registerCollections } from './plugin/registerCollections'
import { registerEndpoints } from './plugin/registerEndpoints'
import { registerHooks } from './plugin/registerHooks'
import { registerJobs } from './plugin/registerJobs'
import { registerTranslations } from './plugin/registerTranslations'
import { registerFormWarnings, registerViews } from './plugin/registerViews'
import { keysAdapter } from './search/keysAdapter'

export type { DedupePluginOptions } from './options'
export type { DedupeEvent, DedupeEventSink } from './plugin/events'
export type { Duplicate } from './queue/live'
export { findDuplicates } from './queue/live'
export type { DedupeFieldConfig } from './schema/fieldConfig'
export { DEDUPE_FIELD_KEY, dedupeCustom } from './schema/fieldConfig'

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
		const adapter = resolved.adapter ? resolved.adapter(keys) : keys

		registerCollections(config, resolved)
		adapter.register?.(config)
		if (options.disabled === true) {
			config.custom = { ...config.custom, [CONTEXT_SOURCE]: null }
			return config
		}
		config.custom = { ...config.custom, [CONTEXT_SOURCE]: { options: resolved, adapter } }
		registerTranslations(config, resolved.translations)
		registerHooks(config, resolved)
		registerEndpoints(config, resolved)
		registerJobs(config, resolved)
		registerViews(config, resolved)
		const warnings = registerFormWarnings(config, resolved)

		// The merge spec needs the sanitized schema, which only exists once Payload has
		// booted, so every configured path is validated here rather than at config time.
		const previousOnInit = config.onInit
		config.onInit = async (payload) => {
			buildContext(payload, resolved, adapter)
			for (const warning of warnings) payload.logger.warn(warning)
			if (previousOnInit) await previousOnInit(payload)
		}
		return config
	},
})

export type { DedupePluginOptions as PluginOptions }
