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
import { calcExpressionOf, computeCalcFields } from '../calc/computeCalcFields'
import { evaluateCondition } from '../conditions/evaluate'
import { noopEventSink } from '../events/noopSink'
import type { FormEventSink } from '../events/types'
import type { AnyFormFieldDefinition } from '../fields/types'
import { firstStepId, isTerminalStepId, resolveNextStepId, stepFieldNames } from '../flow/engine'
import type { FormFlow } from '../flow/types'
import { defaultPresentationDescriptors } from '../presentations/defaults'
import { interpolate } from '../recall/interpolate'
import { buildRecallResolver } from '../recall/resolver'
import { CAPTCHA_TOKEN_KEY, DEFAULT_HONEYPOT_FIELD } from '../spam/constants'
import type { FormFieldInstance, SubmissionValue } from '../submissions/types'
import { en } from '../translations/en'
import { makeTranslate } from '../translations/makeTranslate'
import type { AnyValidationRuleDefinition } from '../validation/types'
import type { FieldRenderer, RendererTranslate } from './contract'
import { emitFormEvent } from './events'
import { FormContext, type FormStepInfo } from './FormContext'
import { type FieldWidth, FormLayout, widthProps } from './FormLayout'
import { Honeypot } from './Honeypot'
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
	/** Honeypot decoy (on by default). `false` removes it; `{ name }` matches a customized server `spam.honeypot.fieldName`. */
	honeypot?: false | { name?: string }
	/** A token from your captcha widget; verified server-side when a captcha provider is configured. */
	captchaToken?: string
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

type CalcFieldHostProps = FieldHostProps & { value: unknown }

/** Hosts a derived (calc) field: read-only, value supplied from `effectiveValues`, never bound via `useField`. */
const CalcFieldHost = ({ field, renderer, value, locale, t }: CalcFieldHostProps) => {
	const id = useId()
	return createElement(renderer, {
		field,
		id,
		name: field.name,
		value,
		onChange: () => {},
		onBlur: () => {},
		errors: [],
		warnings: [],
		required: false,
		disabled: true,
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
	honeypot,
	captchaToken,
	children,
}: FormProps) => {
	const honeypotName = honeypot === false ? null : (honeypot?.name ?? DEFAULT_HONEYPOT_FIELD)
	const honeypotRef = useRef<HTMLInputElement>(null)
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
	const translate = useMemo<RendererTranslate>(() => t ?? makeTranslate(en), [t])

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

	// Authoritative values for derived (calc) fields, recomputed from user answers on every change. The
	// server recomputes these too at submit; the client copy drives the live calc renderer, recall, and submit.
	const effectiveValues = useMemo(
		() => computeCalcFields(form.fields, state.values),
		[form.fields, state.values]
	)

	const recall = useMemo(
		() =>
			buildRecallResolver({
				fields: form.fields,
				values: effectiveValues,
				registry,
				locale,
				t: translate,
			}),
		[form.fields, effectiveValues, registry, locale, translate]
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
			const answers = { ...effectiveValues, [name]: value }
			// Mirror the server: a field whose `validateWhen` is unmet is not validated; clear any stale error.
			if (!evaluateCondition(field.validateWhen, answers)) {
				rawDispatch({ type: 'SET_FIELD_ISSUES', name, errors: [], warnings: [] })
				return
			}
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
		[fieldsByName, effectiveValues, registry, ruleRegistry, locale, translate]
	)

	const visible = visibleFields(form.fields, effectiveValues)
	const stepNames = flow && currentStepId ? stepFieldNames(flow, currentStepId) : []
	const stepVisible: FormFieldInstance[] = stepNames
		.map((name) => visible.find((field) => field.name === name))
		.filter((field): field is FormFieldInstance => Boolean(field))

	const goNext = async () => {
		if (!flow || !currentStepId) {
			return
		}
		const results = await Promise.all(
			stepVisible
				.filter((field) => !calcExpressionOf(field))
				.filter((field) => evaluateCondition(field.validateWhen, effectiveValues))
				.map(async (field) => ({
					field,
					...(await validateFieldValue({
						field,
						value: effectiveValues[field.name],
						registry,
						ruleRegistry,
						answers: effectiveValues,
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
		// Re-entrancy guard: claim the in-flight slot before the async validation window so a fast second
		// activation (double-click, Enter + click) cannot reach the transport and POST the submission twice.
		if (submittingRef.current) {
			return
		}
		submittingRef.current = true
		const visible = visibleFields(form.fields, effectiveValues)
		const results = await Promise.all(
			// Calc fields carry no rules and have no input; they are always satisfied, so skip validating them.
			// A field whose `validateWhen` is unmet is skipped too, mirroring the server (no client/server divergence).
			visible
				.filter((field) => !calcExpressionOf(field))
				.filter((field) => evaluateCondition(field.validateWhen, effectiveValues))
				.map(async (field) => ({
					field,
					...(await validateFieldValue({
						field,
						value: effectiveValues[field.name],
						registry,
						ruleRegistry,
						answers: effectiveValues,
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
			submittingRef.current = false
			return
		}
		rawDispatch({ type: 'SUBMIT_START' })
		const values: SubmissionValue[] = visible
			.filter((field) => !isEmpty(effectiveValues[field.name]))
			.map((field) => ({ field: field.name, value: effectiveValues[field.name] }))
		if (honeypotName) {
			const decoy = honeypotRef.current?.value ?? ''
			if (decoy !== '') {
				values.push({ field: honeypotName, value: decoy })
			}
		}
		if (captchaToken) {
			values.push({ field: CAPTCHA_TOKEN_KEY, value: captchaToken })
		}
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
						{honeypotName ? <Honeypot name={honeypotName} inputRef={honeypotRef} /> : null}
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

	const rendered = (flow ? stepVisible : visible).filter(
		(field) => field.hidden !== true && field.calcDisplay !== false
	)

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
					{honeypotName ? <Honeypot name={honeypotName} inputRef={honeypotRef} /> : null}
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
									{calcExpressionOf(field) ? (
										<CalcFieldHost
											field={recalledField}
											renderer={renderer}
											value={effectiveValues[field.name]}
											locale={locale}
											t={translate}
										/>
									) : (
										<FieldHost
											field={recalledField}
											renderer={renderer}
											locale={locale}
											t={translate}
										/>
									)}
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
