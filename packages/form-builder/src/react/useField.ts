'use client'

import { useCallback } from 'react'
import { useFormContext } from './FormContext'
import { DEFAULT_STEP_ID } from './state'

export type UseFieldResult<TValue = unknown> = {
	value: TValue | undefined
	errors: string[]
	touched: boolean
	setValue: (value: TValue) => void
	/** Mark touched and validate now (call on blur). */
	onBlur: () => void
}

/** Bind one field by name to the form controller: its value, issues, and change/blur handlers. */
export const useField = <TValue = unknown>(name: string): UseFieldResult<TValue> => {
	const { state, dispatch, validateField, stepIdOfField } = useFormContext()
	const touched = state.touched[name] ?? false
	// Reveal is a function of this field's own step, never a single global flag: the field's error shows
	// once it is touched, or once the step it belongs to has been attempted (a blocked advance or submit).
	const stepAttempted = state.attemptedSteps.has(stepIdOfField?.(name) ?? DEFAULT_STEP_ID)
	const showIssues = touched || stepAttempted
	const value = state.values[name] as TValue | undefined

	const setValue = useCallback(
		(next: TValue) => {
			dispatch({ type: 'SET_VALUE', name, value: next })
			// Re-validate on change only once the error is already revealed; never reveal an untouched field mid-typing.
			if (showIssues) {
				validateField(name, next)
			}
		},
		[dispatch, name, showIssues, validateField]
	)

	const onBlur = useCallback(() => {
		dispatch({ type: 'TOUCH', name })
		validateField(name, value)
	}, [dispatch, name, validateField, value])

	return {
		value,
		errors: showIssues ? (state.errors[name] ?? []) : [],
		touched,
		setValue,
		onBlur,
	}
}
