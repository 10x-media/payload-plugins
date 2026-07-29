import type { FormFieldInstance } from '../submissions/types'

/**
 * Normalize a field instance's authored options to `{ value, label }` pairs, dropping entries
 * without a string value and falling back to the value as label. Returns `undefined` when the
 * instance declares no usable options, so callers can distinguish "not a choice field" from an
 * empty choice set. Shared by response aggregation and poll outcome resolution so both read the
 * same choice set from a form document.
 */
export const instanceOptionsOf = (
	field: FormFieldInstance
): { value: string; label: string }[] | undefined => {
	if (!Array.isArray(field.options)) {
		return undefined
	}
	const options = (field.options as Array<{ label?: string; value?: string }>)
		.filter((option) => typeof option?.value === 'string')
		.map((option) => ({
			value: String(option.value),
			label: option.label?.trim() ? option.label : String(option.value),
		}))
	return options.length > 0 ? options : undefined
}
