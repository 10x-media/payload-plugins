import type { CollectionConfig, GlobalConfig, PayloadComponent } from 'payload'

import { type ResolvedDocOptions, toClientProps } from './options'

/** Client component path resolved through the package export map by the import map. */
export const UNDO_REDO_COMPONENT_PATH = '@10x-media/undo-redo/client#UndoRedoControls'

/**
 * The component entry to append to a `beforeDocumentControls` slot, carrying
 * the resolved settings as client props.
 *
 * The settings travel as props rather than being re-derived on the client so
 * there is a single resolution path: whatever the config says is what the
 * mounted controls use, and the debug overlay shows exactly that.
 */
export const undoRedoComponent = (options: ResolvedDocOptions): PayloadComponent<never, never> => ({
	path: UNDO_REDO_COMPONENT_PATH,
	clientProps: toClientProps(options),
})

/**
 * Append the controls to an entity's `admin.components.edit.beforeDocumentControls`,
 * preserving any components the config already declares. Collections and globals
 * share that slot.
 *
 * A `null` options object means undo/redo is off for this entity, and
 * `autoMount: false` means the host mounts the controls itself; both return the
 * config untouched.
 */
const withControls = <T extends CollectionConfig | GlobalConfig>(
	config: T,
	options: ResolvedDocOptions | null
): T => {
	if (!options?.autoMount) return config
	const admin = config.admin ?? {}
	const components = admin.components ?? {}
	const edit = components.edit ?? {}
	return {
		...config,
		admin: {
			...admin,
			components: {
				...components,
				edit: {
					...edit,
					beforeDocumentControls: [
						...(edit.beforeDocumentControls ?? []),
						undoRedoComponent(options),
					],
				},
			},
		},
	}
}

/** Add the undo/redo controls to a collection's edit view. */
export const withUndoRedo = (
	config: CollectionConfig,
	options: ResolvedDocOptions | null
): CollectionConfig => withControls(config, options)

/** Add the undo/redo controls to a global's edit view. */
export const withUndoRedoGlobal = (
	config: GlobalConfig,
	options: ResolvedDocOptions | null
): GlobalConfig => withControls(config, options)
