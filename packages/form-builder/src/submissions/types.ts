import type { Where } from 'payload'

/** A single answered field: the field's machine name and its typed value. */
export type SubmissionValue = { field: string; value: unknown }

/** The four layout widths a field can occupy, shared by the renderer grid and the admin answers view. */
export type SubmissionWidth = 'full' | 'half' | 'third' | 'twoThirds'

/** A localized, self-describing snapshot of an answered field, taken at submit time. */
export type SubmissionDescriptor = {
	field: string
	label: string
	fieldType: string
	optionLabels?: Record<string, string>
	/** The field's authored layout width; absent on old submissions and width-less field types (renders full). */
	width?: SubmissionWidth
	/** For repeater fields: one descriptor per sub-field, shared across all rows. */
	subFieldDescriptors?: SubmissionDescriptor[]
}

/** A per-field validation failure (`path` is the field name, for renderer error mapping). */
export type SubmissionFieldError = { path: string; message: string }

/**
 * A field instance as stored in a form's `fields` blocks array (shared config plus type-specific
 * keys). `name` is absent on bare blocks (e.g. `message`), which are identified by the hidden
 * block row `id` Payload injects into every row (see `fieldKey`).
 */
export type FormFieldInstance = {
	blockType: string
	name?: string
	label?: string
	required?: boolean
	visibleWhen?: Where
	validateWhen?: Where
	[key: string]: unknown
}
