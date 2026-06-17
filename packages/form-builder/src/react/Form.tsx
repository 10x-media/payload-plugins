'use client'

import {
	createElement,
	type FormEvent as ReactFormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'react'
import { noopEventSink } from '../events/noopSink'
import type { FormEventSink } from '../events/types'
import type { AnyFormFieldDefinition } from '../fields/types'
import { firstStepId, isTerminalStepId, resolveNextStepId, stepFieldNames } from '../flow/engine'
import type { FormFlow } from '../flow/types'
import { defaultPresentationDescriptors } from '../presentations/defaults'
import { interpolate } from '../recall/interpolate'
import { buildRecallResolver } from '../recall/resolver'
import type { FormFieldInstance, SubmissionValue } from '../submissions/types'
import type { AnyValidationRuleDefinition } from '../validation/types'
import type { FieldRenderer, RendererTranslate } from './contract'
import { emitFormEvent } from './events'
import { FormContext, type FormStepInfo } from './FormContext'
import { type FieldWidth, FormLayout, widthProps } from './FormLayout'
import { defaultPresentations } from './presentation/presentations'
import { type PresentationsConfig, resolvePresentations } from './presentation/registry'
import type { FormPresentation } from './presentation/types'
import { applyRecall } from './recall'
import { type RenderersConfig, resolveRenderers } from './registry'
import { defaultRenderers } from './renderers'
import { buildFieldTypeRegistry, buildValidationRuleRegistry, visibleFields } from './resolveForm'
import { type FieldErrors, type FormAction, formReducer, initialFormState } from './state'
import { type SubmitFormResult, type SubmitHandler, submitForm } from './submitForm'
import { useField } from './useField'
import { validateFieldValue } from './validateField'

export type FormDocument = {
	id: number | string
	fields: FormFieldInstance[]
	flow?: FormFlow
	/** Stored presentation name; overridden by the `presentation` prop. */
	defaultPresentation?: string
}

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
	nextLabel?: string
	backLabel?: string
	/** Label for the overlay close control (modal/drawer). */
	closeLabel?: string
	successMessage?: string
	/** Active presentation: a name into the registry or an inline presentation. Overrides the form's stored default. */
	presentation?: string | FormPresentation
	/** Per-render presentation overrides merged onto the defaults (add, replace, or `false` to remove). */
	presentations?: PresentationsConfig
	/** Invoked when an overlay presentation dismisses (close button, Escape, outside click, or `dismissOnSuccess`). */
	onClose?: () => void
	/** Accessible name for an overlay surface. */
	title?: string
	/** Seed initial field values (e.g. from `valuesFromSearchParams`). Still validated on submit. */
	initialValues?: Record<string, unknown>
	/** Custom layout: render fields with `useField`/`useFormState` instead of the auto-rendered field loop. */
	children?: ReactNode
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
	nextLabel = 'Next',
	backLabel = 'Back',
	closeLabel = 'Close',
	successMessage = 'Thank you.',
	presentation,
	presentations,
	onClose,
	title,
	initialValues,
	children,
}: FormProps) => {
	const registry = useMemo(() => buildFieldTypeRegistry(fieldTypes), [fieldTypes])
	const ruleRegistry = useMemo(() => buildValidationRuleRegistry(rules), [rules])
	const rendererRegistry = useMemo(() => resolveRenderers(defaultRenderers, renderers), [renderers])
	const presentationRegistry = useMemo(
		() => resolvePresentations(defaultPresentations, presentations),
		[presentations]
	)
	const activePresentation: FormPresentation =
		typeof presentation === 'object'
			? presentation
			: (presentationRegistry.get(presentation ?? form.defaultPresentation ?? 'page') ??
				presentationRegistry.get('page') ??
				defaultPresentationDescriptors.page)
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
		initialFormState({
			...Object.fromEntries(fields.map((field) => [field.name, undefined])),
			...(initialValues ?? {}),
		})
	)

	const recall = useMemo(
		() =>
			buildRecallResolver({
				fields: form.fields,
				values: state.values,
				registry,
				locale,
				t: translate,
			}),
		[form.fields, state.values, registry, locale, translate]
	)

	// Multi-step is active only when a flow declares two or more steps; otherwise this is an ordinary single-step form.
	const flow = form.flow && form.flow.steps.length >= 2 ? form.flow : undefined
	const [currentStepId, setCurrentStepId] = useState<string | undefined>(() =>
		flow ? firstStepId(flow) : undefined
	)
	const [history, setHistory] = useState<string[]>([])

	const startedRef = useRef(false)
	const submittedRef = useRef(false)
	const submittingRef = useRef(false)
	const flowRef = useRef(flow)
	flowRef.current = flow

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

	const visible = visibleFields(form.fields, state.values)
	const stepNames = flow && currentStepId ? stepFieldNames(flow, currentStepId) : []
	const stepVisible: FormFieldInstance[] = stepNames
		.map((name) => visible.find((field) => field.name === name))
		.filter((field): field is FormFieldInstance => Boolean(field))

	const goNext = async () => {
		if (!flow || !currentStepId) {
			return
		}
		const results = await Promise.all(
			stepVisible.map(async (field) => ({
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
		let hasError = false
		for (const result of results) {
			rawDispatch({ type: 'TOUCH', name: result.field.name })
			rawDispatch({
				type: 'SET_FIELD_ISSUES',
				name: result.field.name,
				errors: result.errors,
				warnings: result.warnings,
			})
			if (result.errors.length > 0) {
				hasError = true
			}
		}
		if (hasError) {
			return
		}
		const next = resolveNextStepId(flow, currentStepId, state.values)
		if (!next) {
			return
		}
		emitFormEvent(sinkRef.current, formIdRef.current, {
			type: 'step.completed',
			stepId: currentStepId,
		})
		setHistory((prev) => [...prev, currentStepId])
		setCurrentStepId(next)
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId: next })
	}

	const goBack = () => {
		const prev = history[history.length - 1]
		if (prev === undefined) {
			return
		}
		setHistory((entries) => entries.slice(0, -1))
		setCurrentStepId(prev)
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId: prev })
	}

	useEffect(() => {
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'form.viewed' })
		const mountFlow = flowRef.current
		if (mountFlow) {
			const first = firstStepId(mountFlow)
			if (first) {
				emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId: first })
			}
		}
		return () => {
			if (!submittedRef.current && !submittingRef.current) {
				emitFormEvent(sinkRef.current, formIdRef.current, { type: 'form.abandoned' })
			}
		}
	}, [])

	const handleClose = useCallback(() => {
		onClose?.()
	}, [onClose])

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
				const [firstError] = result.errors
				if (firstError !== undefined) {
					emitFormEvent(sinkRef.current, formIdRef.current, {
						type: 'field.errored',
						field: result.field.name,
						message: firstError,
					})
				}
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
			if (activePresentation.dismissOnSuccess) {
				handleClose()
			}
		} else {
			if (result.fieldErrors) {
				rawDispatch({ type: 'SET_ALL_ISSUES', errors: result.fieldErrors, warnings: {} })
			}
			const message = result.message ?? 'Submission failed'
			rawDispatch({ type: 'SUBMIT_ERROR', message })
			onError?.(message)
		}
	}

	const step: FormStepInfo = flow
		? {
				flow,
				currentStepId,
				stepIndex: flow.steps.findIndex((s) => s.id === currentStepId),
				stepCount: flow.steps.length,
				isFirst: history.length === 0,
				isTerminal: currentStepId ? isTerminalStepId(flow, currentStepId, state.values) : true,
				goNext: () => {
					void goNext()
				},
				goBack,
			}
		: {
				stepIndex: 0,
				stepCount: 1,
				isFirst: true,
				isTerminal: true,
				goNext: () => {},
				goBack: () => {},
			}

	const contextValue = { state, dispatch, validateField, locale, step }

	const PresentationWrapper = activePresentation.Wrapper
	const wrap = (content: ReactNode): ReactNode =>
		PresentationWrapper ? (
			<PresentationWrapper
				presentation={activePresentation}
				open
				onClose={handleClose}
				title={title}
				closeLabel={closeLabel}
			>
				{content}
			</PresentationWrapper>
		) : (
			content
		)

	if (children !== undefined) {
		return (
			<FormContext.Provider value={contextValue}>
				{wrap(
					<form
						className="fb-form-root"
						noValidate
						onSubmit={handleSubmit}
						data-fb-presentation={activePresentation.name}
						data-fb-density={activePresentation.density}
					>
						{children}
					</form>
				)}
			</FormContext.Provider>
		)
	}

	if (state.submitted) {
		return (
			<FormContext.Provider value={contextValue}>
				{wrap(
					<p
						role="status"
						className="fb-form__success"
						data-fb-presentation={activePresentation.name}
						data-fb-density={activePresentation.density}
					>
						{interpolate(successMessage, recall)}
					</p>
				)}
			</FormContext.Provider>
		)
	}

	const rendered = (flow ? stepVisible : visible).filter((field) => field.hidden !== true)

	return (
		<FormContext.Provider value={contextValue}>
			{wrap(
				<form
					className="fb-form-root"
					noValidate
					onSubmit={handleSubmit}
					data-fb-presentation={activePresentation.name}
					data-fb-density={activePresentation.density}
				>
					<FormLayout enabled={layout !== false}>
						{rendered.map((field) => {
							const renderer = rendererRegistry.get(field.blockType)
							if (!renderer) {
								return null
							}
							const width: FieldWidth | undefined =
								typeof field.width === 'string' && FIELD_WIDTHS.has(field.width)
									? (field.width as FieldWidth)
									: undefined
							const recalledField = applyRecall(field, recall)
							return (
								<div key={field.name} {...widthProps(width)}>
									<FieldHost
										field={recalledField}
										renderer={renderer}
										locale={locale}
										t={translate}
									/>
								</div>
							)
						})}
					</FormLayout>
					{state.submitError ? (
						<p role="alert" className="fb-form__submit-error">
							{state.submitError}
						</p>
					) : null}
					{flow ? (
						<div className="fb-form__controls">
							{!step.isFirst ? (
								<button type="button" onClick={goBack} disabled={state.submitting}>
									{backLabel}
								</button>
							) : null}
							{step.isTerminal ? (
								<button type="submit" disabled={state.submitting}>
									{submitLabel}
								</button>
							) : (
								<button
									type="button"
									disabled={state.submitting}
									onClick={() => {
										void goNext()
									}}
								>
									{nextLabel}
								</button>
							)}
						</div>
					) : (
						<button type="submit" disabled={state.submitting}>
							{submitLabel}
						</button>
					)}
				</form>
			)}
		</FormContext.Provider>
	)
}
