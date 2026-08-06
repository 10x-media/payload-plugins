import type { CollectionConfig, GlobalConfig, PayloadComponent } from 'payload'

/** Client component path resolved through the package export map by the import map. */
export const UNDO_REDO_COMPONENT_PATH = '@10x-media/undo-redo/client#UndoRedoControls'

export interface ControlsMountOptions {
	/** Mount the history inspector overlay alongside the buttons. */
	debug?: boolean
}

/**
 * The component entry to append to a `beforeDocumentControls` slot.
 *
 * Stays a bare path string in the default case so generated import maps and
 * config dumps read cleanly, and only becomes an object once there is a client
 * prop to carry.
 */
export const undoRedoComponent = (
	options: ControlsMountOptions = {}
): PayloadComponent<never, never> =>
	options.debug === true
		? { path: UNDO_REDO_COMPONENT_PATH, clientProps: { debug: true } }
		: UNDO_REDO_COMPONENT_PATH

/**
 * Add the undo/redo controls to a collection's edit view by appending to
 * `admin.components.edit.beforeDocumentControls`, preserving any components
 * the config already declares.
 */
export const withUndoRedo = (
	config: CollectionConfig,
	options: ControlsMountOptions = {}
): CollectionConfig => {
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
	options: ControlsMountOptions = {}
): GlobalConfig => {
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
