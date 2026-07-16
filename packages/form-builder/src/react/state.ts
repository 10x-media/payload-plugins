import { isNamedField } from '../fields/fieldKey'
import type { FormFieldInstance } from '../submissions/types'

export type FieldErrors = Record<string, string[]>

export type FormState = {
	values: Record<string, unknown>
	errors: FieldErrors
	warnings: FieldErrors
	touched: Record<string, boolean>
	submitting: boolean
	submitted: boolean
	submitAttempted: boolean
	submitError?: string
}

export type FormAction =
	| { type: 'SET_VALUE'; name: string; value: unknown }
	| { type: 'TOUCH'; name: string }
	| { type: 'SET_FIELD_ISSUES'; name: string; errors: string[]; warnings: string[] }
	| { type: 'SET_ALL_ISSUES'; errors: FieldErrors; warnings: FieldErrors }
	| { type: 'SUBMIT_START' }
	| { type: 'SUBMIT_SUCCESS' }
	| { type: 'SUBMIT_ERROR'; message: string }

/**
 * Per-field defaults for the reducer's initial state. Nameless (bare) blocks carry no value and
 * are skipped. A repeater with a positive `minRows` starts pre-seeded with that many empty rows,
 * matching the schema's own floor. Computed once, ahead of the reducer, so seeding is never an
 * action: it can't touch a field, trigger validation, or (via `Form`'s dispatch wrapper) be
 * mistaken for the user's first edit and fire `form.started`.
 */
export const seedFieldValues = (fields: FormFieldInstance[]): Record<string, unknown> =>
	Object.fromEntries(
		fields.filter(isNamedField).map((field) => {
			if (field.blockType === 'repeater') {
				const minRows = typeof field.minRows === 'number' ? field.minRows : 0
				if (minRows > 0) {
					return [field.name, Array.from({ length: minRows }, () => ({}))]
				}
			}
			return [field.name, undefined]
		})
	)

export const initialFormState = (values: Record<string, unknown>): FormState => ({
	values,
	errors: {},
	warnings: {},
	touched: {},
	submitting: false,
	submitted: false,
	submitAttempted: false,
})

/** Changing a value clears that field's prior errors (re-validated by the caller). */
export const formReducer = (state: FormState, action: FormAction): FormState => {
	switch (action.type) {
		case 'SET_VALUE': {
			const { [action.name]: _removed, ...restErrors } = state.errors
			return {
				...state,
				values: { ...state.values, [action.name]: action.value },
				errors: restErrors,
			}
		}
		case 'TOUCH':
			return state.touched[action.name]
				? state
				: { ...state, touched: { ...state.touched, [action.name]: true } }
		case 'SET_FIELD_ISSUES':
			return {
				...state,
				errors: { ...state.errors, [action.name]: action.errors },
				warnings: { ...state.warnings, [action.name]: action.warnings },
			}
		case 'SET_ALL_ISSUES':
			return { ...state, errors: action.errors, warnings: action.warnings, submitAttempted: true }
		case 'SUBMIT_START':
			return { ...state, submitting: true, submitError: undefined }
		case 'SUBMIT_SUCCESS':
			return { ...state, submitting: false, submitted: true }
		case 'SUBMIT_ERROR':
			return { ...state, submitting: false, submitError: action.message }
		default:
			return state
	}
}
