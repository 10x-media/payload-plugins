import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import type { TranslationsOption } from './translations'

export type FolderPickerPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/folder-picker/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/folder-picker': FolderPickerPluginOptions
	}
}

/**
 * Folder Picker plugin for Payload v3. Currently registers this plugin's
 * translations; future releases will add feature behavior. Authored with
 * `definePlugin` so sibling plugins can detect it by slug.
 */
export const folderPicker = definePlugin<FolderPickerPluginOptions>({
	slug: '@10x-media/folder-picker',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		return config
	},
})

export type { FolderPickerPluginOptions as PluginOptions }
