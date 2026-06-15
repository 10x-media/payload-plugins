'use client'

import type { Dispatch } from 'react'
import { createContext, useContext } from 'react'
import type { FormAction, FormState } from './state'

export type FormContextValue = {
	state: FormState
	dispatch: Dispatch<FormAction>
	/** Validate one field now (client mode) against the supplied value and store its issues. */
	validateField: (name: string, value: unknown) => void
	locale: string
}

export const FormContext = createContext<FormContextValue | null>(null)

/** Read the form controller context. Throws if used outside `<Form>`. */
export const useFormContext = (): FormContextValue => {
	const context = useContext(FormContext)
	if (!context) {
		throw new Error('useFormContext must be used within a <Form>')
	}
	return context
}
