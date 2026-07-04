import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import type { TranslationsOption } from './translations'

export type AutomationsPluginOptions = {
	/** Disable the plugin entirely (incoming config returned untouched). */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/automations/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/**
	 * Trigger slugs available to author automations. Seeded with built-in defaults
	 * and appended to by sibling/third-party plugins (e.g. webhooks pushes
	 * `webhook`) before this plugin runs.
	 */
	triggers?: string[]
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/automations': AutomationsPluginOptions
	}
}

/** Marker written to `config.custom` so consumers (and tests) can read the resolved catalog. */
export const AUTOMATIONS_CUSTOM_KEY = '@10x-media/automations' as const

/**
 * Automations engine for Payload v3. Runs last (`order: 100`) so sibling plugins
 * have already pushed their contributions into `options.triggers`. For Phase 0
 * this only records the resolved trigger list on `config.custom`; the engine
 * itself is built in a later phase.
 */
export const automations = definePlugin<AutomationsPluginOptions>({
	slug: '@10x-media/automations',
	order: 100,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		const triggers = [...new Set(options.triggers ?? [])]
		config.custom = {
			...config.custom,
			[AUTOMATIONS_CUSTOM_KEY]: { triggers },
		}
		return config
	},
})

export type { AutomationsPluginOptions as PluginOptions }
