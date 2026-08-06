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
	 * Mount a history inspector overlay behind a third toolbar button: every
	 * captured entry, the paths it changed, which entry is current, and edits
	 * still inside the capture debounce. Entries are clickable to restore them.
	 *
	 * Development aid only. Leave it off in production so the overlay code never
	 * mounts and captures do not trigger an extra re-render.
	 */
	debug?: boolean
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
		const mount = { debug: options.debug === true }
		return {
			...config,
			collections: config.collections?.map((each) => withUndoRedo(each, mount)),
			globals: config.globals?.map((each) => withUndoRedoGlobal(each, mount)),
		}
	},
})

export type { ControlsMountOptions } from './plugin/withUndoRedo'
export {
	UNDO_REDO_COMPONENT_PATH,
	undoRedoComponent,
	withUndoRedo,
	withUndoRedoGlobal,
} from './plugin/withUndoRedo'
export type { UndoRedoPluginOptions as PluginOptions }
