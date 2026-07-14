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
import { serializeBody } from '../actions/body/serializeBody'
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
import { cn } from './cn'
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

/** Serializable per-form response settings: what the visitor gets after a successful submit. */
export type FormResponseSettings = {
	type?: 'message' | 'redirect' | null
	/** Rich text state serialized via `serializeBody`; shown instead of the plain `successMessage`. */
	message?: unknown
	/** Applies on the custom-`children` path too (part of submit handling); `message`/`submitLabel` only affect default rendering. */
	redirect?: { url?: string | null } | null
	submitLabel?: string | null
}

/** Serializable per-form display settings: what the visitor sees above the fields, before submit. */
export type FormDisplaySettings = {
	showTitle?: boolean
	title?: string
	/** Rich text state serialized via `serializeBody`; rendered above the fields when non-empty. */
	intro?: unknown
}

export type FormDocument = {
	id: number | string
	fields: FormFieldInstance[]
	flow?: FormFlow
	/** Stored presentation name; overridden by the `presentation` prop. */
	defaultPresentation?: string
	response?: FormResponseSettings
	display?: FormDisplaySettings
}

/** Props passed to `renderSubmit`. */
export type SubmitButtonRenderProps = {
	label: string
	submitting: boolean
}

/** Props passed to `renderNext`. */
export type NextButtonRenderProps = {
	label: string
	submitting: boolean
	onClick: () => void
}

/** Props passed to `renderBack`. */
export type BackButtonRenderProps = {
	label: string
	submitting: boolean
	onClick: () => void
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
	/** Submit button label. Precedence: this prop, then the form's `response.submitLabel`, then `'Submit'`. */
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
	/**
	 * Accessible name for an overlay surface (modal/drawer). Hosts choosing between a trigger
	 * label and the form's own display title should prefer `form.display?.title` when
	 * `form.display?.showTitle` is set, falling back to their own label otherwise.
	 */
	title?: string
	/** Seed initial field values (e.g. from `valuesFromSearchParams`). Still validated on submit. */
	initialValues?: Record<string, unknown>
	/** Honeypot decoy (on by default). `false` removes it; `{ name }` matches a customized server `spam.honeypot.fieldName`. */
	honeypot?: false | { name?: string }
	/** A token from your captcha widget; verified server-side when a captcha provider is configured. */
	captchaToken?: string
	/** Custom layout: render fields with `useField`/`useFormState` instead of the auto-rendered field loop. */
	children?: ReactNode
	/** Additional CSS class names applied to the root `<form>` element (and the success node). */
	className?: string
	/** Replace the default submit button entirely. Receives the resolved label and submitting state. */
	renderSubmit?: (props: SubmitButtonRenderProps) => ReactNode
	/** Replace the default "Next" button in multi-step forms. */
	renderNext?: (props: NextButtonRenderProps) => ReactNode
	/** Replace the default "Back" button in multi-step forms. */
	renderBack?: (props: BackButtonRenderProps) => ReactNode
	/** CSS class forwarded to the default submit `<button>`. Ignored when `renderSubmit` is provided. */
	submitButtonClassName?: string
	/** CSS class forwarded to the default "Next" `<button>`. Ignored when `renderNext` is provided. */
	nextButtonClassName?: string
	/** CSS class forwarded to the default "Back" `<button>`. Ignored when `renderBack` is provided. */
	backButtonClassName?: string
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
	submitLabel,
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
	className,
	renderSubmit,
	renderNext,
	renderBack,
	submitButtonClassName,
	nextButtonClassName,
	backButtonClassName,
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
	const docSubmitLabel =
		typeof form.response?.submitLabel === 'string' && form.response.submitLabel.length > 0
			? form.response.submitLabel
			: undefined
	const resolvedSubmitLabel = submitLabel ?? docSubmitLabel ?? 'Submit'

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

	/** Answered visible fields as submission values. Display-only ('none' kind) fields never contribute. */
	const answeredValues = (): SubmissionValue[] =>
		visibleFields(form.fields, effectiveValues)
			.filter((field) => registry.get(field.blockType)?.value !== 'none')
			.filter((field) => !isEmpty(effectiveValues[field.name]))
			.map((field) => ({ field: field.name, value: effectiveValues[field.name] }))

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
				.filter((field) => registry.get(field.blockType)?.value !== 'none')
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
		const next = resolveNextStepId(flow, currentStepId, effectiveValues)
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
			// Display-only ('none' kind, e.g. message) fields are skipped too, mirroring the server.
			// A field whose `validateWhen` is unmet is skipped too, mirroring the server (no client/server divergence).
			visible
				.filter((field) => !calcExpressionOf(field))
				.filter((field) => registry.get(field.blockType)?.value !== 'none')
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

		// Validate sub-fields within each visible repeater, mirroring the server's per-row pass.
		// Errors are stored under the composite key `fieldName[rowIndex].subFieldName` so the
		// repeater renderer can look them up from form state and display them inline.
		for (const field of visible.filter((f) => f.blockType === 'repeater')) {
			const rows = Array.isArray(effectiveValues[field.name])
				? (effectiveValues[field.name] as Array<Record<string, unknown>>)
				: []
			const subFields = Array.isArray(field.subFields)
				? (field.subFields as FormFieldInstance[])
				: []
			for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
				const row = rows[rowIndex] ?? {}
				for (const subField of subFields) {
					if (!evaluateCondition(subField.visibleWhen, row)) continue
					if (!evaluateCondition(subField.validateWhen, row)) continue
					const subResult = await validateFieldValue({
						field: subField,
						value: row[subField.name],
						registry,
						ruleRegistry,
						answers: row,
						locale,
						t: translate,
					})
					const compositeKey = `${field.name}[${rowIndex}].${subField.name}`
					if (subResult.errors.length > 0) errors[compositeKey] = subResult.errors
					if (subResult.warnings.length > 0) warnings[compositeKey] = subResult.warnings
				}
			}
		}

		rawDispatch({ type: 'SET_ALL_ISSUES', errors, warnings })
		if (Object.keys(errors).length > 0) {
			submittingRef.current = false
			return
		}
		rawDispatch({ type: 'SUBMIT_START' })
		const values: SubmissionValue[] = answeredValues()
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
			const redirectUrl =
				form.response?.type === 'redirect' ? form.response.redirect?.url : undefined
			// Part of submit handling, not rendering: fires on the custom-`children` path too.
			// Browser-only: no-op during SSR or in non-DOM test environments.
			if (
				typeof redirectUrl === 'string' &&
				redirectUrl.length > 0 &&
				typeof window !== 'undefined'
			) {
				window.location.assign(redirectUrl)
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
				isTerminal: currentStepId ? isTerminalStepId(flow, currentStepId, effectiveValues) : true,
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

	const contextValue = {
		state,
		dispatch,
		validateField,
		locale,
		step,
		rendererRegistry,
		effectiveValues,
	}

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
						className={cn('fb-form-root', className)}
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
		const responseMessage =
			form.response?.type === 'message' || form.response?.type == null
				? form.response?.message
				: undefined
		const responseHtml = responseMessage
			? serializeBody(responseMessage, { values: answeredValues(), descriptors: [] })
			: undefined
		return (
			<FormContext.Provider value={contextValue}>
				{wrap(
					responseHtml ? (
						// Safe to inject: serializeBody HTML-escapes all text (recall values included) and sanitizes link URLs.
						<div
							role="status"
							className={cn('fb-form__success', className)}
							data-fb-presentation={activePresentation.name}
							data-fb-density={activePresentation.density}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by our escaping serializer, never raw user input
							dangerouslySetInnerHTML={{ __html: responseHtml }}
						/>
					) : (
						<p
							role="status"
							className={cn('fb-form__success', className)}
							data-fb-presentation={activePresentation.name}
							data-fb-density={activePresentation.density}
						>
							{interpolate(successMessage, recall)}
						</p>
					)
				)}
			</FormContext.Provider>
		)
	}

	const rendered = (flow ? stepVisible : visible).filter(
		(field) => field.hidden !== true && field.calcDisplay !== false
	)

	const displayTitleText =
		form.display?.showTitle &&
		typeof form.display.title === 'string' &&
		form.display.title.length > 0
			? interpolate(form.display.title, recall)
			: undefined
	const displayIntroHtml = form.display?.intro
		? serializeBody(form.display.intro, { values: answeredValues(), descriptors: [] })
		: ''

	return (
		<FormContext.Provider value={contextValue}>
			{wrap(
				<form
					className={cn('fb-form-root', className)}
					noValidate
					onSubmit={handleSubmit}
					data-fb-presentation={activePresentation.name}
					data-fb-density={activePresentation.density}
				>
					{honeypotName ? <Honeypot name={honeypotName} inputRef={honeypotRef} /> : null}
					{displayTitleText ? <h2 className="fb-form__title">{displayTitleText}</h2> : null}
					{displayIntroHtml ? (
						<div
							className="fb-form__intro"
							// Safe to inject: serializeBody HTML-escapes all text (recall values included) and sanitizes link URLs.
							// biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is produced by our escaping serializer, never raw user input
							dangerouslySetInnerHTML={{ __html: displayIntroHtml }}
						/>
					) : null}
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
								renderBack ? (
									renderBack({ label: backLabel, submitting: state.submitting, onClick: goBack })
								) : (
									<button
										type="button"
										className={backButtonClassName}
										onClick={goBack}
										disabled={state.submitting}
									>
										{backLabel}
									</button>
								)
							) : null}
							{step.isTerminal ? (
								renderSubmit ? (
									renderSubmit({ label: resolvedSubmitLabel, submitting: state.submitting })
								) : (
									<button
										type="submit"
										className={submitButtonClassName}
										disabled={state.submitting}
									>
										{resolvedSubmitLabel}
									</button>
								)
							) : renderNext ? (
								renderNext({
									label: nextLabel,
									submitting: state.submitting,
									onClick: () => void goNext(),
								})
							) : (
								<button
									type="button"
									className={nextButtonClassName}
									disabled={state.submitting}
									onClick={() => {
										void goNext()
									}}
								>
									{nextLabel}
								</button>
							)}
						</div>
					) : renderSubmit ? (
						renderSubmit({ label: resolvedSubmitLabel, submitting: state.submitting })
					) : (
						<button type="submit" className={submitButtonClassName} disabled={state.submitting}>
							{resolvedSubmitLabel}
						</button>
					)}
				</form>
			)}
		</FormContext.Provider>
	)
}
