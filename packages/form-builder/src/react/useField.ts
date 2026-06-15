'use client'

import { useCallback } from 'react'
import { useFormContext } from './FormContext'

export type UseFieldResult<TValue = unknown> = {
	value: TValue | undefined
	errors: string[]
	warnings: string[]
	touched: boolean
	setValue: (value: TValue) => void
	/** Mark touched and validate now (call on blur). */
	onBlur: () => void
}

/** Bind one field by name to the form controller: its value, issues, and change/blur handlers. */
export const useField = <TValue = unknown>(name: string): UseFieldResult<TValue> => {
	const { state, dispatch, validateField } = useFormContext()
	const touched = state.touched[name] ?? false
	const showIssues = touched || state.submitAttempted
	const value = state.values[name] as TValue | undefined

	const setValue = useCallback(
		(next: TValue) => {
			dispatch({ type: 'SET_VALUE', name, value: next })
			if (touched || state.submitAttempted) {
				validateField(name, next)
			}
		},
		[dispatch, name, touched, state.submitAttempted, validateField]
	)

	const onBlur = useCallback(() => {
		dispatch({ type: 'TOUCH', name })
		validateField(name, value)
	}, [dispatch, name, validateField, value])

	return {
		value,
		errors: showIssues ? (state.errors[name] ?? []) : [],
		warnings: showIssues ? (state.warnings[name] ?? []) : [],
		touched,
		setValue,
		onBlur,
	}
}
