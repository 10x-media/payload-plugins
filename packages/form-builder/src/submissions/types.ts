import type { Where } from 'payload'

/** A single answered field: the field's machine name and its typed value. */
export type SubmissionValue = { field: string; value: unknown }

/** A localized, self-describing snapshot of an answered field, taken at submit time. */
export type SubmissionDescriptor = {
	field: string
	label: string
	fieldType: string
	optionLabels?: Record<string, string>
	/** For repeater fields: one descriptor per sub-field, shared across all rows. */
	subFieldDescriptors?: SubmissionDescriptor[]
}

/** A per-field validation failure (`path` is the field name, for renderer error mapping). */
export type SubmissionFieldError = { path: string; message: string }

/** A field instance as stored in a form's `fields` blocks array (shared config plus type-specific keys). */
export type FormFieldInstance = {
	blockType: string
	name: string
	label?: string
	required?: boolean
	visibleWhen?: Where
	validateWhen?: Where
	[key: string]: unknown
}
