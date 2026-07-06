'use client'

import type { Dispatch } from 'react'
import { createContext, useContext } from 'react'
import type { FormFlow } from '../flow/types'
import type { RendererRegistry } from './registry'
import type { FormAction, FormState } from './state'

/** Multi-step navigation state. Defaults to a single terminal step when the form has no flow. */
export type FormStepInfo = {
	flow?: FormFlow
	currentStepId?: string
	stepIndex: number
	stepCount: number
	isFirst: boolean
	isTerminal: boolean
	goNext: () => void
	goBack: () => void
}

export type FormContextValue = {
	state: FormState
	dispatch: Dispatch<FormAction>
	/** Validate one field now (client mode) against the supplied value and store its issues. */
	validateField: (name: string, value: unknown) => void
	locale: string
	step: FormStepInfo
	/** The active renderer registry, exposed so nested renderers (e.g. repeater) can look up sub-renderers. */
	rendererRegistry: RendererRegistry
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
