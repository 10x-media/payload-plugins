'use client'

import {
	createElement,
	type FormEvent as ReactFormEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useReducer,
	useRef,
} from 'react'
import { noopEventSink } from '../events/noopSink'
import type { FormEventSink } from '../events/types'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance, SubmissionValue } from '../submissions/types'
import type { AnyValidationRuleDefinition } from '../validation/types'
import type { FieldRenderer, RendererTranslate } from './contract'
import { emitFormEvent } from './events'
import { FormContext } from './FormContext'
import { type FieldWidth, FormLayout, widthProps } from './FormLayout'
import { type RenderersConfig, resolveRenderers } from './registry'
import { defaultRenderers } from './renderers'
import { buildFieldTypeRegistry, buildValidationRuleRegistry, visibleFields } from './resolveForm'
import { type FieldErrors, type FormAction, formReducer, initialFormState } from './state'
import { type SubmitFormResult, type SubmitHandler, submitForm } from './submitForm'
import { useField } from './useField'
import { validateFieldValue } from './validateField'

export type FormDocument = { id: number | string; fields: FormFieldInstance[] }

export type FormProps = {
	form: FormDocument
	fieldTypes?: AnyFormFieldDefinition[]
	rules?: AnyValidationRuleDefinition[]
	renderers?: RenderersConfig
	apiRoute?: string
	onSubmit?: SubmitHandler
	onSuccess?: (submissionId?: string) => void
	onError?: (message: string) => void
	events?: FormEventSink
	t?: RendererTranslate
	locale?: string
	layout?: boolean
	submitLabel?: string
	successMessage?: string
}

const isEmpty = (value: unknown): boolean =>
	value == null || value === '' || (Array.isArray(value) && value.length === 0)

const FIELD_WIDTHS = new Set<string>(['full', 'half', 'third', 'twoThirds'])

type FieldHostProps = {
	field: FormFieldInstance
	renderer: FieldRenderer
	locale: string
	t: RendererTranslate
}

const FieldHost = ({ field, renderer, locale, t }: FieldHostProps) => {
	const id = useId()
	const { value, errors, warnings, setValue, onBlur } = useField(field.name)
	return createElement(renderer, {
		field,
		id,
		name: field.name,
		value,
		onChange: setValue,
		onBlur,
		errors,
		warnings,
		required: Boolean(field.required),
		locale,
		t,
	})
}

/** The headless form controller: state, progressive client validation, conditional visibility, submission, events. */
export const Form = ({
	form,
	fieldTypes,
	rules,
	renderers,
	apiRoute,
	onSubmit,
	onSuccess,
	onError,
	events,
	t,
	locale = 'en',
	layout,
	submitLabel = 'Submit',
	successMessage = 'Thank you.',
}: FormProps) => {
	const registry = useMemo(() => buildFieldTypeRegistry(fieldTypes), [fieldTypes])
	const ruleRegistry = useMemo(() => buildValidationRuleRegistry(rules), [rules])
	const rendererRegistry = useMemo(() => resolveRenderers(defaultRenderers, renderers), [renderers])
	const fieldsByName = useMemo(
		() => new Map(form.fields.map((field) => [field.name, field])),
		[form.fields]
	)
	const translate = useMemo<RendererTranslate>(() => t ?? ((key) => key), [t])

	// Latest-value refs so event emission and the mount/unmount effect tolerate an inline `events` prop or a changing form id.
	const sinkRef = useRef<FormEventSink>(noopEventSink)
	sinkRef.current = events ?? noopEventSink
	const formIdRef = useRef('')
	formIdRef.current = String(form.id)

	const [state, rawDispatch] = useReducer(formReducer, form.fields, (fields) =>
		initialFormState(Object.fromEntries(fields.map((field) => [field.name, undefined])))
	)

	const startedRef = useRef(false)
	const submittedRef = useRef(false)
	const submittingRef = useRef(false)

	const dispatch = useCallback((action: FormAction) => {
		if (action.type === 'SET_VALUE' && !startedRef.current) {
			startedRef.current = true
			emitFormEvent(sinkRef.current, formIdRef.current, { type: 'form.started' })
		}
		rawDispatch(action)
	}, [])

	const validateField = useCallback(
		(name: string, value: unknown) => {
			const field = fieldsByName.get(name)
			if (!field) {
				return
			}
			const answers = { ...state.values, [name]: value }
			void validateFieldValue({
				field,
				value,
				registry,
				ruleRegistry,
				answers,
				locale,
				t: translate,
			}).then(({ errors, warnings }) => {
				rawDispatch({ type: 'SET_FIELD_ISSUES', name, errors, warnings })
				const [firstError] = errors
				if (firstError !== undefined) {
					emitFormEvent(sinkRef.current, formIdRef.current, {
						type: 'field.errored',
						field: name,
						message: firstError,
					})
				}
			})
		},
		[fieldsByName, state.values, registry, ruleRegistry, locale, translate]
	)

	useEffect(() => {
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'form.viewed' })
		return () => {
			if (!submittedRef.current && !submittingRef.current) {
				emitFormEvent(sinkRef.current, formIdRef.current, { type: 'form.abandoned' })
			}
		}
	}, [])

	const handleSubmit = async (event: ReactFormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const visible = visibleFields(form.fields, state.values)
		const results = await Promise.all(
			visible.map(async (field) => ({
				field,
				...(await validateFieldValue({
					field,
					value: state.values[field.name],
					registry,
					ruleRegistry,
					answers: state.values,
					locale,
					t: translate,
				})),
			}))
		)
		const errors: FieldErrors = {}
		const warnings: FieldErrors = {}
		for (const result of results) {
			if (result.errors.length > 0) {
				errors[result.field.name] = result.errors
			}
			if (result.warnings.length > 0) {
				warnings[result.field.name] = result.warnings
			}
		}
		rawDispatch({ type: 'SET_ALL_ISSUES', errors, warnings })
		if (Object.keys(errors).length > 0) {
			return
		}
		submittingRef.current = true
		rawDispatch({ type: 'SUBMIT_START' })
		const values: SubmissionValue[] = visible
			.filter((field) => !isEmpty(state.values[field.name]))
			.map((field) => ({ field: field.name, value: state.values[field.name] }))
		const result: SubmitFormResult = onSubmit
			? await onSubmit({ formId: form.id, values })
			: await submitForm({ formId: form.id, values, apiRoute })
		submittingRef.current = false
		if (result.ok) {
			submittedRef.current = true
			rawDispatch({ type: 'SUBMIT_SUCCESS' })
			emitFormEvent(sinkRef.current, formIdRef.current, {
				type: 'submission.created',
				submissionId: result.submissionId,
			})
			onSuccess?.(result.submissionId)
		} else {
			if (result.fieldErrors) {
				rawDispatch({ type: 'SET_ALL_ISSUES', errors: result.fieldErrors, warnings: {} })
			}
			const message = result.message ?? 'Submission failed'
			rawDispatch({ type: 'SUBMIT_ERROR', message })
			onError?.(message)
		}
	}

	if (state.submitted) {
		return (
			<p role="status" className="fb-form__success">
				{successMessage}
			</p>
		)
	}

	const visible = visibleFields(form.fields, state.values)

	return (
		<FormContext.Provider value={{ state, dispatch, validateField, locale }}>
			<form className="fb-form-root" noValidate onSubmit={handleSubmit}>
				<FormLayout enabled={layout !== false}>
					{visible.map((field) => {
						const renderer = rendererRegistry.get(field.blockType)
						if (!renderer) {
							return null
						}
						const width: FieldWidth | undefined =
							typeof field.width === 'string' && FIELD_WIDTHS.has(field.width)
								? (field.width as FieldWidth)
								: undefined
						return (
							<div key={field.name} {...widthProps(width)}>
								<FieldHost field={field} renderer={renderer} locale={locale} t={translate} />
							</div>
						)
					})}
				</FormLayout>
				{state.submitError ? (
					<p role="alert" className="fb-form__submit-error">
						{state.submitError}
					</p>
				) : null}
				<button type="submit" disabled={state.submitting}>
					{submitLabel}
				</button>
			</form>
		</FormContext.Provider>
	)
}
