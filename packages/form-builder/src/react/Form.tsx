'use client'

import {
	type CSSProperties,
	type FormEvent as ReactFormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'react'
import type { BodyConverter } from '../actions/body/converters'
import { serializeBody } from '../actions/body/serializeBody'
import { calcExpressionOf, computeCalcFields } from '../calc/computeCalcFields'
import { evaluateCondition } from '../conditions/evaluate'
import { noopEventSink } from '../events/noopSink'
import type { FormEventSink } from '../events/types'
import { fieldKey, isNamedField, type NamedFormFieldInstance } from '../fields/fieldKey'
import type { AnyFormFieldDefinition } from '../fields/types'
import { firstStepId, isTerminalStepId, resolveNextStepId, stepFieldNames } from '../flow/engine'
import type { FormFlow } from '../flow/types'
import type {
	FormButtonSettings,
	FormDocument,
	FormPollSettings,
	FormResponseSettings,
} from '../form/types'
import {
	DEFAULT_PRESENTATION_NAME,
	defaultPresentationDescriptors,
} from '../presentations/defaults'
import { interpolate } from '../recall/interpolate'
import { buildRecallResolver, descriptorsFor } from '../recall/resolver'
import { CAPTCHA_TOKEN_KEY, DEFAULT_HONEYPOT_FIELD, HONEYPOT_VALUE_KEY } from '../spam/constants'
import type { FormFieldInstance, SubmissionValue } from '../submissions/types'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { makeTranslate } from '../translations/makeTranslate'
import { resolveMessage } from '../validation/message'
import type { AnyValidationRuleDefinition } from '../validation/types'
import { cn } from './cn'
import type { RendererTranslate } from './contract'
import { emitFormEvent } from './events'
import { FormContext, type FormContextValue, type FormStepInfo } from './FormContext'
import {
	type BackButtonRenderProps,
	FormControls,
	type NextButtonRenderProps,
	type SubmitButtonRenderProps,
} from './FormControls'
import { FormFields } from './FormFields'
import { Honeypot } from './Honeypot'
import { defaultPresentations } from './presentation/presentations'
import { type PresentationsConfig, resolvePresentations } from './presentation/registry'
import type { FormPresentation } from './presentation/types'
import { type RenderersConfig, resolveRenderers } from './registry'
import { defaultRenderers } from './renderers'
import { buildFieldTypeRegistry, buildValidationRuleRegistry, visibleFields } from './resolveForm'
import {
	DEFAULT_STEP_ID,
	type FieldErrors,
	type FormAction,
	formReducer,
	initialFormState,
	seedFieldValues,
} from './state'
import { type SubmitFormResult, type SubmitHandler, submitForm } from './submitForm'
import { validateFieldValue } from './validateField'

export type {
	BackButtonRenderProps,
	NextButtonRenderProps,
	SubmitButtonRenderProps,
} from './FormControls'
// FormResponseSettings, FormButtonSettings, FormPollSettings, and FormDocument live in
// `../form/types` (no 'use client') so server code (e.g. `toFormDocument` in a Server Component)
// can use them without pulling in this client module. Re-exported here so `./react` and existing
// `from './Form'` imports keep working unchanged.
export type { FormButtonSettings, FormDocument, FormPollSettings, FormResponseSettings }

/**
 * The success response passed to `onSuccess`, recall-resolved and (for a message) serialized with the
 * form's active converters, so a host can render or toast the resolved response without re-deriving it.
 */
export type FormSuccessResponse =
	| { type: 'message'; html?: string }
	| { type: 'redirect'; url?: string }

/** The second argument to `onSuccess`: the resolved success response (an object, so it can grow). */
export type FormSuccessResult = { response?: FormSuccessResponse }

export type FormProps = {
	form: FormDocument
	fieldTypes?: AnyFormFieldDefinition[]
	rules?: AnyValidationRuleDefinition[]
	renderers?: RenderersConfig
	apiRoute?: string
	onSubmit?: SubmitHandler
	/**
	 * Called after a successful submission with the submission id and the resolved success response
	 * (recall-applied, serialized with `converters`), so a host can toast or render it. Fires in both
	 * `successBehavior` modes and on the custom-`children` path.
	 */
	onSuccess?: (submissionId?: string, result?: FormSuccessResult) => void
	onError?: (message: string) => void
	/**
	 * Custom Lexical block converters (e.g. host `icon`/`badge` blocks) spread over the defaults for the
	 * client serializer, so those blocks survive in the success message and in the `onSuccess` response.
	 */
	converters?: Record<string, BodyConverter>
	/**
	 * What happens on a successful submit. `'replace'` (default) swaps the form for the success screen;
	 * `'reset'` clears the fields in place and shows no success screen, so a host can toast via `onSuccess`
	 * and keep the form usable.
	 */
	successBehavior?: 'replace' | 'reset'
	events?: FormEventSink
	t?: RendererTranslate
	locale?: string
	layout?: boolean
	/** Submit button label. Precedence: this prop, then the form's `buttons.submitLabel`, then the translated default. */
	submitLabel?: string
	/** "Next" button label for multi-step forms. Precedence: this prop, then the form's `buttons.nextLabel`, then the translated default. */
	nextLabel?: string
	/** "Back" button label for multi-step forms. Precedence: this prop, then the form's `buttons.prevLabel`, then the translated default. */
	prevLabel?: string
	/** Label for the overlay close control (modal/drawer). */
	closeLabel?: string
	successMessage?: string
	/** Active presentation: a name into the registry or an inline presentation. Defaults to `'page'` when omitted. */
	presentation?: string | FormPresentation
	/** Per-render presentation overrides merged onto the defaults (add, replace, or `false` to remove). */
	presentations?: PresentationsConfig
	/** Invoked when an overlay presentation dismisses (close button, Escape, outside click, or `dismissOnSuccess`). */
	onClose?: () => void
	/**
	 * Accessible name for an overlay surface (modal/drawer). Hosts choosing between a trigger
	 * label and the form's own admin title should prefer `form.title` when set, falling back to
	 * their own label otherwise.
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
	/** Chrome rendered inside the form, above the fields, in default mode (e.g. `<FormSteps />`). */
	header?: ReactNode
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

/** Visually hidden but screen-reader-announced, for the "Step X of Y" live region (no host CSS required). */
const SR_ONLY: CSSProperties = {
	position: 'absolute',
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: 'hidden',
	clip: 'rect(0, 0, 0, 0)',
	whiteSpace: 'nowrap',
	border: 0,
}

/** The base field name of an error key: the part before a repeater composite suffix (`name[0].sub`). */
const baseFieldKey = (key: string): string => {
	const bracket = key.indexOf('[')
	return bracket === -1 ? key : key.slice(0, bracket)
}

/** The id of the first flow step (in order) that owns an errored field, or undefined when none does. */
const firstStepWithError = (flow: FormFlow, errors: FieldErrors): string | undefined => {
	const errored = new Set(Object.keys(errors).map(baseFieldKey))
	return flow.steps.find((flowStep) => flowStep.fields.some((key) => errored.has(key)))?.id
}

/** The first focusable element under `root` that a step transition should land on (skips hidden/honeypot). */
const focusFirstIn = (root: HTMLElement | null, selector: string): void => {
	const target = root?.querySelector<HTMLElement>(selector)
	target?.focus()
}

/** A stored button label counts only when it is a non-empty string; anything else falls through. */
const storedLabel = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined

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
	converters,
	successBehavior = 'replace',
	events,
	t,
	locale = 'en',
	layout,
	submitLabel,
	nextLabel,
	prevLabel,
	closeLabel,
	successMessage,
	presentation,
	presentations,
	onClose,
	title,
	initialValues,
	honeypot,
	captchaToken,
	children,
	header,
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
			: (presentationRegistry.get(presentation ?? DEFAULT_PRESENTATION_NAME) ??
				presentationRegistry.get(DEFAULT_PRESENTATION_NAME) ??
				defaultPresentationDescriptors.page)
	const fieldsByName = useMemo(
		() => new Map(form.fields.filter(isNamedField).map((field) => [field.name, field])),
		[form.fields]
	)
	const translate = useMemo<RendererTranslate>(() => t ?? makeTranslate(en), [t])
	const resolvedCloseLabel = closeLabel ?? translate(keys.formClose)
	const resolvedSuccessMessage = successMessage ?? translate(keys.formSuccess)
	const docButtons: FormButtonSettings | undefined = form.buttons
	const labels = useMemo(
		() => ({
			prev: prevLabel ?? storedLabel(docButtons?.prevLabel) ?? translate(keys.formBack),
			next: nextLabel ?? storedLabel(docButtons?.nextLabel) ?? translate(keys.formNext),
			submit: submitLabel ?? storedLabel(docButtons?.submitLabel) ?? translate(keys.formSubmit),
		}),
		[prevLabel, nextLabel, submitLabel, docButtons, translate]
	)

	// Latest-value refs so event emission and the mount/unmount effect tolerate an inline `events` prop or a changing form id.
	const sinkRef = useRef<FormEventSink>(noopEventSink)
	sinkRef.current = events ?? noopEventSink
	const formIdRef = useRef('')
	formIdRef.current = String(form.id)

	const [state, rawDispatch] = useReducer(formReducer, form.fields, (fields) =>
		initialFormState({
			...seedFieldValues(fields),
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

	// Multi-step is active only when the form is flagged `multistep` and its flow declares two or more
	// steps. With the flag off the form renders as a single page even if flow data is still stored.
	const flow =
		form.multistep === true && form.flow && form.flow.steps.length >= 2 ? form.flow : undefined
	const [currentStepId, setCurrentStepId] = useState<string | undefined>(() =>
		flow ? firstStepId(flow) : undefined
	)
	const [history, setHistory] = useState<string[]>([])

	const startedRef = useRef(false)
	const submittedRef = useRef(false)
	const submittingRef = useRef(false)
	const advancingRef = useRef(false)
	const flowRef = useRef(flow)
	flowRef.current = flow

	// Per-step error reveal: a field maps to the id of the flow step whose `fields` include it, else the
	// default step (single-step forms, or a field assigned to no step), so a single-step form collapses to
	// one step and today's behavior.
	const stepIdOfField = useMemo(() => {
		const map = new Map<string, string>()
		if (flow) {
			for (const flowStep of flow.steps) {
				for (const key of flowStep.fields) {
					map.set(key, flowStep.id)
				}
			}
		}
		return (fieldKey: string): string => map.get(fieldKey) ?? DEFAULT_STEP_ID
	}, [flow])
	const allStepIds = useMemo(
		() => (flow ? flow.steps.map((flowStep) => flowStep.id) : [DEFAULT_STEP_ID]),
		[flow]
	)

	// Focus management for step transitions and blocked advances/submits. A pending request is performed
	// by an effect after the render it triggers, so focus lands on the DOM that reflects the new state.
	const formRef = useRef<HTMLFormElement>(null)
	const pendingFocusRef = useRef<'stepStart' | 'firstInvalid' | null>(null)
	const [focusNonce, setFocusNonce] = useState(0)
	const requestFocus = (intent: 'stepStart' | 'firstInvalid') => {
		pendingFocusRef.current = intent
		setFocusNonce((nonce) => nonce + 1)
	}

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
				rawDispatch({ type: 'SET_FIELD_ISSUES', name, errors: [] })
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
			}).then(({ errors }) => {
				rawDispatch({ type: 'SET_FIELD_ISSUES', name, errors })
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

	/** Visible, answered named fields. Display-only ('none' kind) and nameless (bare) fields never contribute. */
	const answerableFields = (): NamedFormFieldInstance[] =>
		visibleFields(form.fields, effectiveValues)
			.filter((field) => registry.get(field.blockType)?.value !== 'none')
			.filter(isNamedField)
			.filter((field) => !isEmpty(effectiveValues[field.name]))

	/** Answered visible fields as raw submission values, sent to the server on submit. */
	const answeredValues = (): SubmissionValue[] =>
		answerableFields().map((field) => ({ field: field.name, value: effectiveValues[field.name] }))

	/**
	 * Same fields, formatted via `recall` (option labels, Yes/No, localized dates): recall-fidelity
	 * values for client-rendered templates, matching what the server gives email-team's body.
	 */
	const formattedValues = (): SubmissionValue[] =>
		answerableFields().map((field) => ({ field: field.name, value: recall(field.name) }))

	/**
	 * The recall-resolved success response: a redirect's url, or the response message serialized with
	 * the active `converters` (so host blocks survive). Shared by the success screen and the value
	 * handed to `onSuccess`, so both stay identical.
	 */
	const resolveSuccessResponse = (): FormSuccessResponse | undefined => {
		const response = form.response
		if (response?.type === 'redirect') {
			return { type: 'redirect', url: response.redirect?.url ?? undefined }
		}
		const message =
			response?.type === 'message' || response?.type == null ? response?.message : undefined
		if (!message) {
			return undefined
		}
		return {
			type: 'message',
			html: serializeBody(message, {
				values: formattedValues(),
				descriptors: descriptorsFor(answerableFields()),
				converters,
			}),
		}
	}

	// Steps address fields by key: machine names for named fields, block row ids for bare blocks.
	// `step.fields` is membership only; render order follows `form.fields` (the order of `visible`),
	// so a step shows its fields in the form's field order, not the flow-builder entry order.
	const stepKeys = flow && currentStepId ? stepFieldNames(flow, currentStepId) : []
	const stepKeySet = new Set(stepKeys)
	const stepVisible: FormFieldInstance[] = visible.filter((field) =>
		stepKeySet.has(fieldKey(field))
	)

	// Validate the sub-fields of the given repeaters, one pass per visible row, returning composite-key
	// errors (`fieldName[rowIndex].subFieldName`). Shared by submit and step navigation so both mirror
	// the server's per-row pass and neither lets an invalid required sub-field slip through.
	const validateRepeaterSubFields = async (
		repeaters: FormFieldInstance[]
	): Promise<FieldErrors> => {
		const errors: FieldErrors = {}
		for (const field of repeaters.filter(
			(f): f is NamedFormFieldInstance => f.blockType === 'repeater' && isNamedField(f)
		)) {
			const rows = Array.isArray(effectiveValues[field.name])
				? (effectiveValues[field.name] as Array<Record<string, unknown>>)
				: []
			const subFields = (
				Array.isArray(field.subFields) ? (field.subFields as FormFieldInstance[]) : []
			).filter(isNamedField)
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
				}
			}
		}
		return errors
	}

	const goNext = async () => {
		// Re-entrancy guard: a double-click during async validation must not push the same step onto
		// history twice (which would need two Back presses to undo).
		if (!flow || !currentStepId || advancingRef.current) {
			return
		}
		advancingRef.current = true
		try {
			const results = await Promise.all(
				stepVisible
					.filter((field) => !calcExpressionOf(field))
					.filter((field) => registry.get(field.blockType)?.value !== 'none')
					.filter(isNamedField)
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
				})
				if (result.errors.length > 0) {
					hasError = true
				}
			}
			// Mirror submit: validate the step's repeater sub-fields too, so a required sub-field can't be
			// skipped past on a non-terminal step (errors surface inline via the composite key).
			const repeaterErrors = await validateRepeaterSubFields(stepVisible)
			for (const [compositeKey, errs] of Object.entries(repeaterErrors)) {
				rawDispatch({ type: 'SET_FIELD_ISSUES', name: compositeKey, errors: errs })
				hasError = true
			}
			if (hasError) {
				// Mark this step attempted so its fields reveal their errors, then focus the first invalid one.
				rawDispatch({ type: 'MARK_STEP_ATTEMPTED', stepId: currentStepId })
				requestFocus('firstInvalid')
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
			requestFocus('stepStart')
			emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId: next })
		} finally {
			advancingRef.current = false
		}
	}

	const goBack = () => {
		const prev = history[history.length - 1]
		if (prev === undefined) {
			return
		}
		setHistory((entries) => entries.slice(0, -1))
		setCurrentStepId(prev)
		requestFocus('stepStart')
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId: prev })
	}

	// Jump to an earlier step (from the terminal Submit when an earlier step is invalid), rebuilding the
	// Back stack as the flow's linear path up to it so Back still works.
	const navigateToStep = (stepId: string) => {
		if (!flow || stepId === currentStepId) {
			return
		}
		const idx = flow.steps.findIndex((flowStep) => flowStep.id === stepId)
		if (idx < 0) {
			return
		}
		setHistory(flow.steps.slice(0, idx).map((flowStep) => flowStep.id))
		setCurrentStepId(stepId)
		emitFormEvent(sinkRef.current, formIdRef.current, { type: 'step.viewed', stepId })
	}

	// Perform a pending focus request after the render it triggered, so it lands on the DOM that reflects
	// the new state (a changed step, or freshly revealed errors). Null on mount, so the first render never
	// steals focus. currentStepId and focusNonce are intentional re-run triggers: a blocked advance keeps
	// the same step, so the nonce forces a fresh run; the body reads only refs, hence the ignore.
	// biome-ignore lint/correctness/useExhaustiveDependencies: currentStepId/focusNonce are re-run triggers, not read in the body
	useEffect(() => {
		const intent = pendingFocusRef.current
		if (!intent) {
			return
		}
		pendingFocusRef.current = null
		if (intent === 'firstInvalid') {
			focusFirstIn(formRef.current, '[aria-invalid="true"]')
			return
		}
		const region = formRef.current?.querySelector<HTMLElement>('[data-fb-step-region]')
		if (region) {
			region.focus()
		} else {
			focusFirstIn(formRef.current, 'input:not([type="hidden"]), select, textarea')
		}
	}, [currentStepId, focusNonce])

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
			// Display-only ('none' kind, e.g. message) and nameless (bare) fields are skipped too, mirroring the server.
			// A field whose `validateWhen` is unmet is skipped too, mirroring the server (no client/server divergence).
			visible
				.filter((field) => !calcExpressionOf(field))
				.filter((field) => registry.get(field.blockType)?.value !== 'none')
				.filter(isNamedField)
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
		}

		// Validate sub-fields within each visible repeater (composite keys `fieldName[rowIndex].subFieldName`),
		// mirroring the server's per-row pass, so the repeater renderer surfaces them inline.
		Object.assign(errors, await validateRepeaterSubFields(visible))

		const hasErrors = Object.keys(errors).length > 0
		// A terminal submit validates every step, so every step is attempted (its errors may now reveal);
		// a valid submit clears stale errors without marking anything.
		rawDispatch({ type: 'SET_ALL_ISSUES', errors, steps: hasErrors ? allStepIds : [] })
		if (hasErrors) {
			submittingRef.current = false
			// On a multi-step form, route to the first step that owns an invalid field rather than failing in
			// place on the terminal step, then focus its first invalid field.
			if (flow && currentStepId) {
				const target = firstStepWithError(flow, errors)
				if (target) {
					navigateToStep(target)
				}
			}
			requestFocus('firstInvalid')
			return
		}
		rawDispatch({ type: 'SUBMIT_START' })
		const values: SubmissionValue[] = answeredValues()
		if (honeypotName) {
			const decoy = honeypotRef.current?.value ?? ''
			if (decoy !== '') {
				// Submit the decoy under a reserved key, not its cosmetic DOM name, so a real field sharing
				// that name is never stripped or mistaken for the honeypot on the server.
				values.push({ field: HONEYPOT_VALUE_KEY, value: decoy })
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
			// A submission happened, so the unmount effect must not emit `form.abandoned`, in either mode.
			submittedRef.current = true
			emitFormEvent(sinkRef.current, formIdRef.current, {
				type: 'submission.created',
				submissionId: result.submissionId,
			})
			// Resolve the response before a reset clears the answers the recall reads from.
			onSuccess?.(result.submissionId, { response: resolveSuccessResponse() })
			if (successBehavior === 'reset') {
				// Reset in place: the host handles feedback (e.g. a toast via onSuccess); no success screen.
				rawDispatch({
					type: 'RESET',
					values: { ...seedFieldValues(form.fields), ...(initialValues ?? {}) },
				})
				// The reducer holds only values/errors; flow position and the lifecycle `started` ref live
				// outside it. Reset them too so a multi-step form returns to its first step (not stranded on
				// the terminal one) and a fresh fill re-emits `form.started`. `submittedRef` stays set: a
				// submission did happen, so the unmount guard must not report the completed form abandoned.
				if (flow) {
					setCurrentStepId(firstStepId(flow))
					setHistory([])
				}
				startedRef.current = false
			} else {
				rawDispatch({ type: 'SUBMIT_SUCCESS' })
				if (activePresentation.dismissOnSuccess) {
					handleClose()
				}
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
				rawDispatch({ type: 'SET_ALL_ISSUES', errors: result.fieldErrors, steps: allStepIds })
			}
			const message = result.message ?? translate(keys.formSubmitFailed)
			rawDispatch({ type: 'SUBMIT_ERROR', message })
			onError?.(message)
		}
	}

	const isTerminalStep =
		flow && currentStepId ? isTerminalStepId(flow, currentStepId, effectiveValues) : true

	// Enter on a multi-step form: on a non-terminal step, advance like Next (validate, then advance or
	// reveal + focus); on the terminal step, fall through to native submit (guarded by `submittingRef`).
	// A textarea (Enter = newline), select (confirm), and buttons/submit inputs (activation) are exempt.
	// Single-step forms keep native Enter-to-submit. The `<form>` is the plugin's even in children mode,
	// so this is the only place a host could get this behavior.
	const handleKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
		if (!flow || event.key !== 'Enter') {
			return
		}
		const target = event.target
		if (
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			target instanceof HTMLButtonElement
		) {
			return
		}
		if (
			target instanceof HTMLInputElement &&
			(target.type === 'submit' || target.type === 'button')
		) {
			return
		}
		if (!isTerminalStep) {
			event.preventDefault()
			void goNext()
		}
	}

	const step: FormStepInfo = flow
		? {
				flow,
				currentStepId,
				stepIndex: flow.steps.findIndex((s) => s.id === currentStepId),
				stepCount: flow.steps.length,
				isFirst: history.length === 0,
				isTerminal: isTerminalStep,
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

	// The "Step X of Y" announcement (aria-live + the step region's accessible name).
	const stepStatusText = flow
		? resolveMessage(translate(keys.formStepStatus), {
				current: String(step.stepIndex + 1),
				total: String(step.stepCount),
			})
		: ''
	// Whether the current step has been attempted and still has a revealed error (drives the step-level alert).
	const currentStepHasError =
		flow != null &&
		currentStepId != null &&
		state.attemptedSteps.has(currentStepId) &&
		Object.entries(state.errors).some(
			([key, errs]) => errs.length > 0 && stepIdOfField(baseFieldKey(key)) === currentStepId
		)

	const renderedFields = (flow ? stepVisible : visible).filter(
		(field) => field.hidden !== true && field.calcDisplay !== false
	)

	const contextValue: FormContextValue = {
		form,
		state,
		dispatch,
		validateField,
		locale,
		step,
		rendererRegistry,
		labels,
		t: translate,
		effectiveValues,
		recall,
		renderedFields,
		converters,
		stepIdOfField,
	}

	const PresentationWrapper = activePresentation.Wrapper
	const wrap = (content: ReactNode): ReactNode =>
		PresentationWrapper ? (
			<PresentationWrapper
				presentation={activePresentation}
				open
				onClose={handleClose}
				title={title}
				closeLabel={resolvedCloseLabel}
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
						ref={formRef}
						className={cn('fb-form-root', className)}
						noValidate
						onSubmit={handleSubmit}
						onKeyDown={handleKeyDown}
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
		const successResponse = resolveSuccessResponse()
		const responseHtml = successResponse?.type === 'message' ? successResponse.html : undefined
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
							{interpolate(resolvedSuccessMessage, recall)}
						</p>
					)
				)}
			</FormContext.Provider>
		)
	}

	return (
		<FormContext.Provider value={contextValue}>
			{wrap(
				<form
					ref={formRef}
					className={cn('fb-form-root', className)}
					noValidate
					onSubmit={handleSubmit}
					onKeyDown={handleKeyDown}
					data-fb-presentation={activePresentation.name}
					data-fb-density={activePresentation.density}
				>
					{honeypotName ? <Honeypot name={honeypotName} inputRef={honeypotRef} /> : null}
					{header}
					{flow ? (
						<>
							{/* Announces "Step X of Y" politely on each step change. A bare aria-live region, not
							    role=status, so the single status role stays with the form's success outcome. */}
							<div aria-live="polite" aria-atomic="true" style={SR_ONLY}>
								{stepStatusText}
							</div>
							{/* Focus lands here on a step change (the region's start), so keyboard/SR users move with it.
							    A plain focusable container, not a named group; the aria-live region above does the announcing. */}
							<div data-fb-step-region tabIndex={-1} className="fb-form__step">
								<FormFields layout={layout} />
							</div>
							{currentStepHasError ? (
								<p role="alert" className="fb-form__step-error">
									{translate(keys.formStepInvalid)}
								</p>
							) : null}
						</>
					) : (
						<FormFields layout={layout} />
					)}
					{state.submitError ? (
						<p role="alert" className="fb-form__submit-error">
							{state.submitError}
						</p>
					) : null}
					<FormControls
						backButtonClassName={backButtonClassName}
						nextButtonClassName={nextButtonClassName}
						submitButtonClassName={submitButtonClassName}
						renderBack={renderBack}
						renderNext={renderNext}
						renderSubmit={renderSubmit}
					/>
				</form>
			)}
		</FormContext.Provider>
	)
}
