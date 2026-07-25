'use client'

import type { Dispatch } from 'react'
import { createContext, useContext } from 'react'
import type { BodyConverter } from '../actions/body/converters'
import type { FormFlow } from '../flow/types'
import type { FormDocument } from '../form/types'
import type { RecallResolver } from '../recall/resolver'
import type { FormFieldInstance } from '../submissions/types'
import type { RendererTranslate } from './contract'
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

/** Resolved chrome button labels. Precedence per label: the `<Form>` prop, then the form's `buttons` value, then the translated default. */
export type FormControlLabels = {
	prev: string
	next: string
	submit: string
}

/**
 * The form controller's context, read via `useFormContext` (or the focused `useField`,
 * `useFormState`, and `useFormStep` hooks). Available anywhere under `<Form>`, including
 * custom `children` layouts and custom field renderers.
 */
export type FormContextValue = {
	/** The document rendered by this `<Form>`. Custom chrome reads host-added `buttons` keys from here. */
	form: FormDocument
	/** Current form state: values, errors, touched, submitting, submitted, submitError. */
	state: FormState
	/**
	 * Dispatch a `FormAction` (see `./state` for the action union). Custom field layouts
	 * typically dispatch `TOUCH` or `SET_FIELD_ISSUES`; prefer `useField` for value binding,
	 * which wires `SET_VALUE` and validation for you.
	 */
	dispatch: Dispatch<FormAction>
	/** Validate one field now (client mode) against the supplied value and store its issues. */
	validateField: (name: string, value: unknown) => void
	/** The locale passed to `<Form>` (defaults to `'en'`). */
	locale: string
	/** Multi-step navigation state and the `goNext`/`goBack` handlers. */
	step: FormStepInfo
	/** The active renderer registry, exposed so nested renderers (e.g. repeater) can look up sub-renderers. */
	rendererRegistry: RendererRegistry
	/** Resolved prev/next/submit labels used by `<FormControls>` and available to custom chrome. */
	labels: FormControlLabels
	/** The active translator: the `<Form>` `t` prop, else the bundled English fallback. */
	t: RendererTranslate
	/** Calc-authoritative answers: `state.values` overlaid with derived calc values. Consumers fall back to `state.values` when absent. */
	effectiveValues?: Record<string, unknown>
	/** Recall resolver for token interpolation, exposed so `<FormFields>` and custom layouts can format values. */
	recall?: RecallResolver
	/** The exact visible field list the default loop renders (post hidden/calc filter). Consumed by `<FormFields>`. */
	renderedFields?: FormFieldInstance[]
	/** The `<Form>` `converters` prop, so client rich-text serialization (e.g. the `message` renderer) honors host blocks. */
	converters?: Record<string, BodyConverter>
	/** Maps a field key to the id of the step it belongs to (or the default step), for per-step error reveal. */
	stepIdOfField?: (fieldKey: string) => string
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
