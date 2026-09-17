import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import type { TranslationsOption } from './translations'

export type ImpersonationPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/impersonation/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/impersonation': ImpersonationPluginOptions
	}
}

/**
 * Impersonation plugin for Payload v3. Beta scaffold: registers translations
 * and the `@10x-media/impersonation` slug so siblings can detect it. Sign-in-as,
 * records, and UI land after the research brief is folded in.
 */
export const impersonation = definePlugin<ImpersonationPluginOptions>({
	slug: '@10x-media/impersonation',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		return config
	},
})

export type { ImpersonationPluginOptions as PluginOptions }
