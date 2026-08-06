import { type Config, definePlugin } from 'payload'

import { resolveDocOptions, type UndoRedoPluginOptions } from './plugin/options'
import { registerTranslations } from './plugin/registerTranslations'
import { withUndoRedo, withUndoRedoGlobal } from './plugin/withUndoRedo'

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
			collections: config.collections?.map((each) =>
				withUndoRedo(each, resolveDocOptions(options, 'collections', each.slug))
			),
			globals: config.globals?.map((each) =>
				withUndoRedoGlobal(each, resolveDocOptions(options, 'globals', each.slug))
			),
		}
	},
})

export type {
	ControlsClientProps,
	DocScope,
	ResolvedDocOptions,
	ShortcutKeys,
	UndoRedoDocOptions,
	UndoRedoPluginOptions,
} from './plugin/options'
export {
	DEFAULT_CAPTURE_DEBOUNCE_MS,
	DEFAULT_SHORTCUTS,
	resolveDocOptions,
	toClientProps,
} from './plugin/options'
export {
	UNDO_REDO_COMPONENT_PATH,
	undoRedoComponent,
	withUndoRedo,
	withUndoRedoGlobal,
} from './plugin/withUndoRedo'
export type { UndoRedoFieldConfig } from './schema/fieldConfig'
export { UNDO_REDO_FIELD_KEY, undoRedoCustom } from './schema/fieldConfig'
export type { UndoRedoPluginOptions as PluginOptions }
