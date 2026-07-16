import type { FormFieldInstance } from '../submissions/types'

/** A field instance guaranteed to carry a machine name (every value-bearing field). */
export type NamedFormFieldInstance = FormFieldInstance & { name: string }

/** Whether the instance carries a machine name. Bare blocks (e.g. `message`) do not. */
export const isNamedField = (instance: FormFieldInstance): instance is NamedFormFieldInstance =>
	typeof instance.name === 'string'

/**
 * Stable identity for a field instance: its machine name, else the hidden block row `id` Payload
 * injects into every row (bare blocks carry no name). Flow step assignments and React render keys
 * use this, so name-based flows keep working for named fields while bare blocks are addressable
 * by row id. Admin-authored rows always carry a client-generated id; a bare row created via
 * `payload.create` without an explicit `id` gets one during the write, so it cannot be
 * flow-referenced in that same call.
 */
export const fieldKey = (instance: FormFieldInstance): string =>
	instance.name ?? String(instance.id)
