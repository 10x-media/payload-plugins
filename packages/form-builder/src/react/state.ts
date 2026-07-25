import { isNamedField } from '../fields/fieldKey'
import type { FormFieldInstance } from '../submissions/types'

export type FieldErrors = Record<string, string[]>

/**
 * The step a field's error reveal is keyed to when the form has no flow, or the field belongs to no
 * step. A single-step form has exactly this one step, so its reveal collapses to the old global one.
 */
export const DEFAULT_STEP_ID = '__form__'

export type FormState = {
	values: Record<string, unknown>
	errors: FieldErrors
	touched: Record<string, boolean>
	submitting: boolean
	submitted: boolean
	/**
	 * The step ids whose validation the user has attempted (a blocked advance, or a submit). A field
	 * reveals its error when it is touched or its own step is in this set, never via a single global flag,
	 * so a submit attempt cannot pre-reveal errors on a step the visitor has not reached.
	 */
	attemptedSteps: Set<string>
	submitError?: string
}

export type FormAction =
	| { type: 'SET_VALUE'; name: string; value: unknown }
	| { type: 'TOUCH'; name: string }
	| { type: 'SET_FIELD_ISSUES'; name: string; errors: string[] }
	| { type: 'SET_ALL_ISSUES'; errors: FieldErrors; steps: string[] }
	| { type: 'MARK_STEP_ATTEMPTED'; stepId: string }
	| { type: 'REMOVE_REPEATER_ROW'; name: string; index: number }
	| { type: 'SUBMIT_START' }
	| { type: 'SUBMIT_SUCCESS' }
	| { type: 'SUBMIT_ERROR'; message: string }
	| { type: 'RESET'; values: Record<string, unknown> }

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
	touched: {},
	submitting: false,
	submitted: false,
	attemptedSteps: new Set(),
})

/**
 * Re-key composite entries (`name[i].sub`) after repeater row `removed` is deleted: drop the removed
 * index and shift every higher index down by one, so surviving rows keep their own errors/touched
 * flags instead of inheriting a deleted or shifted neighbour's. Matches on the `name[<int>]` prefix,
 * so it is agnostic to the sub-key shape after `]` and needs no sub-field list. Returns the same
 * reference when nothing changed, so an unrelated dispatch does not churn state identity.
 */
const reindexRepeaterKeys = <T>(
	map: Record<string, T>,
	name: string,
	removed: number
): Record<string, T> => {
	const prefix = `${name}[`
	let changed = false
	const next: Record<string, T> = {}
	for (const [key, value] of Object.entries(map)) {
		if (!key.startsWith(prefix)) {
			next[key] = value
			continue
		}
		const close = key.indexOf(']', prefix.length)
		const idx = close === -1 ? Number.NaN : Number(key.slice(prefix.length, close))
		if (!Number.isInteger(idx) || idx < removed) {
			next[key] = value
			continue
		}
		if (idx === removed) {
			changed = true
			continue
		}
		next[`${name}[${idx - 1}]${key.slice(close + 1)}`] = value
		changed = true
	}
	return changed ? next : map
}

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
			}
		case 'SET_ALL_ISSUES':
			return {
				...state,
				errors: action.errors,
				attemptedSteps: new Set([...state.attemptedSteps, ...action.steps]),
			}
		case 'MARK_STEP_ATTEMPTED':
			return state.attemptedSteps.has(action.stepId)
				? state
				: { ...state, attemptedSteps: new Set([...state.attemptedSteps, action.stepId]) }
		case 'REMOVE_REPEATER_ROW':
			// The row value is removed by the field's own SET_VALUE; this shifts the composite issue keys
			// (`name[i].sub`) that a plain value array cannot carry, so a deleted row's errors never strand
			// on a survivor or linger unreachably.
			return {
				...state,
				errors: reindexRepeaterKeys(state.errors, action.name, action.index),
				touched: reindexRepeaterKeys(state.touched, action.name, action.index),
			}
		case 'SUBMIT_START':
			return { ...state, submitting: true, submitError: undefined }
		case 'SUBMIT_SUCCESS':
			return { ...state, submitting: false, submitted: true }
		case 'SUBMIT_ERROR':
			return { ...state, submitting: false, submitError: action.message }
		case 'RESET':
			return initialFormState(action.values)
		default:
			return state
	}
}
