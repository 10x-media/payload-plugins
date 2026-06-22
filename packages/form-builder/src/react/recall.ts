import { interpolate } from '../recall/interpolate'
import type { RecallResolver } from '../recall/resolver'
import type { FormFieldInstance } from '../submissions/types'

type Option = { label?: string; value?: string }

/**
 * Return a copy of the field with recall tokens interpolated in its label, description, and option
 * labels. Never alters `name` (identity for React keys and state lookups must stay stable).
 */
export const applyRecall = (
	field: FormFieldInstance,
	resolve: RecallResolver
): FormFieldInstance => {
	const next: FormFieldInstance = { ...field }
	if (typeof field.label === 'string') {
		next.label = interpolate(field.label, resolve)
	}
	if (typeof field.description === 'string') {
		next.description = interpolate(field.description, resolve)
	}
	if (Array.isArray(field.options)) {
		next.options = (field.options as Option[]).map((option) =>
			option && typeof option.label === 'string'
				? { ...option, label: interpolate(option.label, resolve) }
				: option
		)
	}
	return next
}
