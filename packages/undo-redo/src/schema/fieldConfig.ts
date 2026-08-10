/**
 * Per-field opt-out, declared next to the field it applies to.
 *
 * It has to live under `admin.custom` rather than the field's own `custom`:
 * Payload strips `custom` from the client config (it is listed in
 * `serverOnlyFieldProperties`, see payload/src/fields/config/client.ts), while
 * `admin.custom` is documented as available on both sides and survives. The
 * controls run on the client, so `admin.custom` is the only channel that
 * reaches them.
 */

/** Namespace this plugin claims inside the shared `admin.custom` object. */
export const UNDO_REDO_FIELD_KEY = 'undoRedo'

export interface UndoRedoFieldConfig {
	/**
	 * Leave this field out of the undo history entirely: its changes create no
	 * entries and undo never writes to it. Applies to the whole subtree when set
	 * on anything with children: a group, array, blocks field, tabs field, an
	 * individual tab, a row or a collapsible.
	 */
	disabled?: boolean
}

/**
 * Build the `admin.custom` fragment for a field.
 *
 * ```ts
 * { name: 'content', type: 'richText', admin: { custom: undoRedoCustom({ disabled: true }) } }
 * ```
 *
 * Spread it when the field already carries other custom data:
 * `custom: { ...existing, ...undoRedoCustom({ disabled: true }) }`.
 */
export const undoRedoCustom = (
	config: UndoRedoFieldConfig
): Record<string, UndoRedoFieldConfig> => ({ [UNDO_REDO_FIELD_KEY]: config })
