import type { CollectionConfig, GlobalConfig } from 'payload'

/** Client component path resolved through the package export map by the import map. */
export const UNDO_REDO_COMPONENT_PATH = '@10x-media/undo-redo/client#UndoRedoControls'

/**
 * Add the undo/redo controls to a collection's edit view by appending to
 * `admin.components.edit.beforeDocumentControls`, preserving any components
 * the config already declares.
 */
export const withUndoRedo = (config: CollectionConfig): CollectionConfig => {
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
						UNDO_REDO_COMPONENT_PATH,
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
export const withUndoRedoGlobal = (config: GlobalConfig): GlobalConfig => {
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
						UNDO_REDO_COMPONENT_PATH,
					],
				},
			},
		},
	}
}
