import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import { withUndoRedo, withUndoRedoGlobal } from './plugin/withUndoRedo'
import type { TranslationsOption } from './translations'

export type UndoRedoPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/undo-redo/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/undo-redo': UndoRedoPluginOptions
	}
}

/**
 * Client-side undo/redo for the admin document form, independent of document
 * versions. Adds undo and redo controls before the document controls on every
 * collection and global edit view. History lives in memory for the editor
 * session only; nothing reaches the server until the user saves.
 */
export const undoRedo = definePlugin<UndoRedoPluginOptions>({
	slug: '@10x-media/undo-redo',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		return {
			...config,
			collections: config.collections?.map(withUndoRedo),
			globals: config.globals?.map(withUndoRedoGlobal),
		}
	},
})

export { UNDO_REDO_COMPONENT_PATH, withUndoRedo, withUndoRedoGlobal } from './plugin/withUndoRedo'
export type { UndoRedoPluginOptions as PluginOptions }
