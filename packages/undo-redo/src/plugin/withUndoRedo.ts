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
 * Add the undo/redo controls to a collection's edit view by appending to
 * `admin.components.edit.beforeDocumentControls`, preserving any components
 * the config already declares.
 *
 * A `null` options object means undo/redo is off for this collection, and
 * `autoMount: false` means the host mounts the controls itself; both return the
 * config untouched.
 */
export const withUndoRedo = (
	config: CollectionConfig,
	options: ResolvedDocOptions | null
): CollectionConfig => {
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

/**
 * Global variant: globals declare the same slot under
 * `admin.components.elements.beforeDocumentControls` (see
 * @payloadcms/next renderDocumentSlots).
 */
export const withUndoRedoGlobal = (
	config: GlobalConfig,
	options: ResolvedDocOptions | null
): GlobalConfig => {
	if (!options?.autoMount) return config
	const admin = config.admin ?? {}
	const components = admin.components ?? {}
	const elements = components.elements ?? {}
	return {
		...config,
		admin: {
			...admin,
			components: {
				...components,
				elements: {
					...elements,
					beforeDocumentControls: [
						...(elements.beforeDocumentControls ?? []),
						undoRedoComponent(options),
					],
				},
			},
		},
	}
}
