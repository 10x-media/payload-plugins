'use client'

import {
	useConfig,
	useDocumentInfo,
	useEditDepth,
	useForm,
	useFormFields,
	useFormModified,
	useHotkey,
	usePreferences,
	useServerFunctions,
} from '@payloadcms/ui'
import type { FormState, JsonObject } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { DOC_PREFERENCE_PROPERTY, docPreferenceKeyFor } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { GateResult } from '../types'
import { DefaultLayout } from './chrome/Layout'
import {
	type BeforeNextHandler,
	type PrimaryAction,
	useFormVariants,
	WizardContext,
	type WizardContextValue,
} from './context'
import { evaluate } from './evaluate'
import { computeSaveGuard } from './guard'
import { resolveSlot } from './slots'
import {
	resolveStepKey,
	stepErrorCount,
	stepIsRenderable,
	stepIsValid,
	stepPaths,
	visibleSteps,
} from './steps'
import type { ClientVariant, Outcome, RenderedSlots, VariantProviderProps } from './types'

type RunnerProps = VariantProviderProps & {
	/** Rendered above the steps: the upload area on upload collections. */
	beforeSteps: React.ReactNode
	/**
	 * Filled in by the runner with a function the form calls after every settled edit. A ref
	 * rather than a prop callback because the form owns `onChange` and the step engine lives
	 * here, and neither should re-render the other for it.
	 */
	onFormChange: React.RefObject<(() => void) | null>
	/** The variant's top bar, rendered inside the wizard context so its save button can read the guard. */
	header: React.ReactNode
	readOnly: boolean
	variant: ClientVariant
}

/** What the chrome components need beyond the wizard API: pre-rendered nodes and resolved slots. */
export type RunnerInternals = {
	beforeSteps: React.ReactNode
	/** Whether the progress tabs render, so the step header can leave out the label they already show. */
	progressVisible: boolean
	rendered: Record<string, React.ReactNode>
	/** Slot levels for the current step, most specific first. */
	slotLevels: (RenderedSlots | undefined)[]
}

export const RunnerInternalsContext = createContext<RunnerInternals | null>(null)

export const useRunnerInternals = (): RunnerInternals => {
	const value = useContext(RunnerInternalsContext)
	if (!value) {
		throw new Error('This component must render inside a form variant with steps.')
	}
	return value
}

/**
 * Footer overrides a step set through `setPrimaryAction` and `setMessage`, tagged with the step
 * that set them so they lapse on their own when the step changes. A reset effect would not do:
 * the new step's own effects run before the runner's and would be wiped.
 */
type StepOverride = {
	action: null | PrimaryAction
	message: null | string
	stepKey: null | string
}

/** Joins step keys into one selector result so the runner re-renders only when the set changes. */
const STEP_KEY_SEPARATOR = '\n'

const setByPath = (target: JsonObject, path: string, value: unknown): void => {
	const segments = path.split('.')
	let cursor: Record<string, unknown> = target
	for (const segment of segments.slice(0, -1)) {
		const next = cursor[segment]
		if (!next || typeof next !== 'object') {
			cursor[segment] = {}
		}
		cursor = cursor[segment] as Record<string, unknown>
	}
	cursor[segments[segments.length - 1] as string] = value
}

/**
 * The step engine over Payload's form state: which steps are visible, which one is current,
 * validation of the current step on a forward move, gates through the evaluate endpoint, the
 * save guard, and `finish`. Keyed by variant in `VariantForm`, so switching between step
 * variants resets the engine while the form underneath keeps its values.
 */
export const Runner: React.FC<RunnerProps> = (props) => {
	const { beforeSteps, header, onFormChange, readOnly, rendered, slots, variant } = props
	const { t } = useTranslation()
	const {
		collectionSlug,
		inDrawer,
		outcome,
		setOutcome,
		setState,
		setStepKey,
		state: wizardState,
		stepKey,
	} = useFormVariants()
	const {
		config: {
			routes: { api: apiRoute },
			serverURL,
		},
		getEntityConfig,
	} = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug })
	const { id, docPermissions, getDocPreferences, hasPublishPermission } = useDocumentInfo()
	const { dispatchFields, getData, getFields, setModified, setSubmitted, submit } = useForm()
	const { getFormState } = useServerFunctions()
	const { setPreference } = usePreferences()
	const editDepth = useEditDepth()
	const modified = useFormModified()

	const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(
		() => new Set(variant.steps.filter((step) => step.initiallyVisible).map((step) => step.key))
	)
	const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set())
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<null | string>(null)
	const [blockedMessage, setBlockedMessage] = useState<null | string>(null)
	const [override, setOverride] = useState<StepOverride>({
		action: null,
		message: null,
		stepKey: null,
	})
	const handlersRef = useRef(new Set<BeforeNextHandler>())
	const refreshAbortRef = useRef<AbortController | null>(null)
	// The step already stored, so restoring one on open does not write it straight back.
	const writtenStepRef = useRef<null | string>(props.storedSteps[variant.key] ?? null)
	const busyRef = useRef(false)
	busyRef.current = busy
	const wizardStateRef = useRef(wizardState)
	wizardStateRef.current = wizardState

	const renderableJoined = useFormFields(([fields]) =>
		variant.steps
			.filter((step) => stepIsRenderable(step, Object.keys(fields ?? {})))
			.map((step) => step.key)
			.join(STEP_KEY_SEPARATOR)
	)
	const renderableKeys = useMemo(
		() => new Set(renderableJoined.split(STEP_KEY_SEPARATOR).filter(Boolean)),
		[renderableJoined]
	)

	/**
	 * Failing fields per step, so the progress tabs can say where the error is. Joined into one
	 * string, as the renderable set is, so the runner re-renders when a count changes and not on
	 * every keystroke.
	 */
	const errorsJoined = useFormFields(([fields]) =>
		variant.steps.map((step) => stepErrorCount(step, fields ?? {})).join(STEP_KEY_SEPARATOR)
	)
	const errorCounts = useMemo(() => {
		const counts = errorsJoined.split(STEP_KEY_SEPARATOR)
		return new Map(variant.steps.map((step, i) => [step.key, Number(counts[i]) || 0]))
	}, [errorsJoined, variant.steps])
	const errorCount = useCallback((key: string) => errorCounts.get(key) ?? 0, [errorCounts])

	const steps = useMemo(
		() => visibleSteps(variant.steps, visibleKeys, renderableKeys),
		[renderableKeys, variant.steps, visibleKeys]
	)
	const currentKey = resolveStepKey(steps, stepKey)
	const step = steps.find((candidate) => candidate.key === currentKey) ?? null
	const index = step ? steps.indexOf(step) : -1
	const isLast = index >= 0 && index === steps.length - 1

	const currentKeyRef = useRef(currentKey)
	currentKeyRef.current = currentKey
	const own = override.stepKey === currentKey
	const primaryAction = own ? override.action : null
	const message = own ? override.message : null

	const setPrimaryAction = useCallback((action: null | PrimaryAction) => {
		setOverride((previous) => ({
			action,
			message: previous.stepKey === currentKeyRef.current ? previous.message : null,
			stepKey: currentKeyRef.current,
		}))
	}, [])

	const setMessage = useCallback((text: null | string) => {
		setOverride((previous) => ({
			action: previous.stepKey === currentKeyRef.current ? previous.action : null,
			message: text,
			stepKey: currentKeyRef.current,
		}))
	}, [])

	useEffect(() => {
		if (currentKey !== stepKey) {
			setStepKey(currentKey)
		}
	}, [currentKey, setStepKey, stepKey])

	/**
	 * Remembers the open section of a sections variant in the document's own Payload
	 * preferences, beside the tab and collapsible state of the same document, so a save or a
	 * reload comes back to it. A guided variant is a sequence and always starts at its first
	 * step, and a document that does not exist yet has nothing to remember it by.
	 *
	 * `setPreference` merges, so Payload's own properties on that document are left alone and
	 * each variant keeps its own step.
	 */
	useEffect(() => {
		if (
			variant.navigation !== 'free' ||
			!id ||
			!currentKey ||
			currentKey === writtenStepRef.current
		) {
			return
		}
		writtenStepRef.current = currentKey
		void setPreference(
			docPreferenceKeyFor(collectionSlug, id),
			{ [DOC_PREFERENCE_PROPERTY]: { steps: { [variant.key]: currentKey } } },
			true
		)
	}, [collectionSlug, currentKey, id, setPreference, variant.key, variant.navigation])

	// Every step the user has stood on stays open to them, so a look back at an earlier answer
	// does not cost a click through everything in between.
	useEffect(() => {
		if (currentKey) {
			setVisited((previous) =>
				previous.has(currentKey) ? previous : new Set(previous).add(currentKey)
			)
		}
	}, [currentKey])

	const needsServer = useMemo(
		() => variant.steps.some((candidate) => candidate.hasCondition),
		[variant.steps]
	)

	const go = useCallback(
		(key: string) => {
			setStepKey(key)
			setError(null)
			if (typeof window !== 'undefined') {
				window.scrollTo({ behavior: 'smooth', top: 0 })
			}
		},
		[setStepKey]
	)

	const neighbour = useCallback(
		(fromKey: string, direction: 1 | -1, visible: ReadonlySet<string>): null | string => {
			const order = variant.steps.map((candidate) => candidate.key)
			const from = order.indexOf(fromKey)
			for (let i = from + direction; i >= 0 && i < order.length; i += direction) {
				const key = order[i] as string
				if (visible.has(key) && renderableKeys.has(key)) {
					return key
				}
			}
			return null
		},
		[renderableKeys, variant.steps]
	)

	const callEvaluate = useCallback(
		(phase: 'gate' | 'visibility', gateStep?: string, signal?: AbortSignal) =>
			evaluate({
				apiRoute,
				body: {
					collection: collectionSlug,
					id,
					inDrawer,
					phase,
					state: wizardStateRef.current,
					step: gateStep,
					values: getData() as JsonObject,
					variant: variant.key,
				},
				serverURL,
				signal,
			}),
		[apiRoute, collectionSlug, getData, id, inDrawer, serverURL, variant.key]
	)

	/**
	 * Re-evaluates which steps are visible against the values as they stand, so a condition
	 * shows or hides its step as soon as the field it reads changes rather than at the next
	 * move. Payload debounces `onChange` and fires it only when form state really changed, so
	 * this costs one request per settled edit and no render work. On an existing document that
	 * request also costs the reads the evaluate endpoint makes; see `buildEvaluateEndpoint`.
	 *
	 * The step the user is standing on stays visible whatever the answer, since a condition
	 * turning false underneath them would otherwise move them off it mid-edit. The next move
	 * takes the server's answer as it comes and drops the step then.
	 */
	const refreshVisibility = useCallback(async () => {
		if (!needsServer || readOnly || busyRef.current) {
			return
		}
		refreshAbortRef.current?.abort()
		const controller = new AbortController()
		refreshAbortRef.current = controller
		try {
			const response = await callEvaluate('visibility', undefined, controller.signal)
			if (controller.signal.aborted) {
				return
			}
			const next = new Set(response.visible)
			if (currentKeyRef.current) {
				next.add(currentKeyRef.current)
			}
			setVisibleKeys(next)
		} catch {
			// A background refresh is nobody's click; the next move is where a failure belongs.
		}
	}, [callEvaluate, needsServer, readOnly])

	useEffect(() => {
		onFormChange.current = () => {
			void refreshVisibility()
		}
		return () => {
			onFormChange.current = null
		}
	}, [onFormChange, refreshVisibility])

	useEffect(() => () => refreshAbortRef.current?.abort(), [])

	/**
	 * Server-side validation of the current step only. Payload validates the whole form and
	 * shows an error only once the form is `submitted`, so the step's entries are merged back
	 * with their `valid` and `errorMessage` and `submitted` is set. That flag is form-wide and
	 * Payload does not reset it, so after the first refused move any invalid field shows its
	 * error as soon as it appears on screen.
	 */
	const validateStep = useCallback(
		async (current: NonNullable<typeof step>): Promise<boolean> => {
			if (current.kind !== 'fields') {
				return true
			}
			const docPreferences = await getDocPreferences()
			const result = await getFormState({
				id,
				collectionSlug,
				docPermissions,
				docPreferences,
				formState: getFields(),
				operation: id ? 'update' : 'create',
				renderAllFields: false,
				schemaPath: collectionSlug,
				skipValidation: false,
			})
			const serverState = result?.state
			if (!serverState) {
				return true
			}
			if (stepIsValid(current, serverState)) {
				return true
			}
			const local = getFields()
			const merged: FormState = {}
			for (const path of stepPaths(current, serverState)) {
				const server = serverState[path]
				const mine = local[path]
				if (server && mine) {
					merged[path] = { ...mine, errorMessage: server.errorMessage, valid: server.valid }
				}
			}
			dispatchFields({ type: 'UPDATE_MANY', formState: merged })
			setSubmitted(true)
			return false
		},
		[
			collectionSlug,
			dispatchFields,
			docPermissions,
			getDocPreferences,
			getFields,
			getFormState,
			id,
			setSubmitted,
		]
	)

	/**
	 * A gate's `patch`. Plain values go straight into form state; a path that names an array or
	 * blocks field needs its rows rebuilt, which only the server can do, so the whole state is
	 * rebuilt from the patched data in that case.
	 */
	const applyPatch = useCallback(
		async (gate: Extract<GateResult, { result: 'patch' }>): Promise<void> => {
			if (gate.state) {
				const patch = gate.state
				setState((previous) => ({ ...previous, ...patch }))
			}
			if (!gate.values) {
				return
			}
			const fields = getFields()
			const entries = Object.entries(gate.values)
			const simple = entries.every(([path]) => {
				const field = fields[path]
				return field && !('rows' in field)
			})
			if (simple) {
				for (const [path, value] of entries) {
					dispatchFields({ type: 'UPDATE', path, value })
				}
				setModified(true)
				return
			}
			const data = getData() as JsonObject
			for (const [path, value] of entries) {
				setByPath(data, path, value)
			}
			const docPreferences = await getDocPreferences()
			const { state } = await getFormState({
				id,
				collectionSlug,
				data,
				docPermissions,
				docPreferences,
				operation: id ? 'update' : 'create',
				renderAllFields: true,
				schemaPath: collectionSlug,
				skipValidation: true,
			})
			if (state) {
				dispatchFields({ type: 'REPLACE_STATE', sanitize: true, state })
				setModified(true)
			}
		},
		[
			collectionSlug,
			dispatchFields,
			docPermissions,
			getData,
			getDocPreferences,
			getFields,
			getFormState,
			id,
			setModified,
			setState,
		]
	)

	const fail = useCallback((reason: string) => {
		setError(reason)
	}, [])

	const next = useCallback(async (): Promise<boolean> => {
		if (!step || busy) {
			return false
		}
		setBusy(true)
		setError(null)
		try {
			let visible = visibleKeys
			if (!readOnly) {
				for (const handler of handlersRef.current) {
					if ((await handler({ step })) === false) {
						return false
					}
				}
				if (!(await validateStep(step))) {
					fail(t(keys.stepInvalid))
					return false
				}
				if (step.hasGate || needsServer) {
					const response = await callEvaluate(step.hasGate ? 'gate' : 'visibility', step.key)
					visible = new Set(response.visible)
					setVisibleKeys(visible)
					if (response.gate?.result === 'block') {
						fail(response.gate.message)
						return false
					}
					if (response.gate?.result === 'patch') {
						await applyPatch(response.gate)
					}
				}
			}
			const target = neighbour(step.key, 1, visible)
			if (target) {
				go(target)
			}
			return true
		} catch (caught) {
			fail(caught instanceof Error ? caught.message : String(caught))
			return false
		} finally {
			setBusy(false)
		}
	}, [
		applyPatch,
		busy,
		callEvaluate,
		fail,
		go,
		needsServer,
		neighbour,
		readOnly,
		step,
		t,
		validateStep,
		visibleKeys,
	])

	/** Back and direct jumps re-evaluate conditions but run no validation and no gate. */
	const moveFreely = useCallback(
		async (targetKey: null | string, fromKey: string, direction: 1 | -1): Promise<void> => {
			if (busy) {
				return
			}
			setBusy(true)
			try {
				let visible = visibleKeys
				if (needsServer && !readOnly) {
					const response = await callEvaluate('visibility')
					visible = new Set(response.visible)
					setVisibleKeys(visible)
				}
				const target = targetKey ?? neighbour(fromKey, direction, visible)
				if (target && visible.has(target) && renderableKeys.has(target)) {
					go(target)
				}
			} catch (caught) {
				fail(caught instanceof Error ? caught.message : String(caught))
			} finally {
				setBusy(false)
			}
		},
		[busy, callEvaluate, fail, go, needsServer, neighbour, readOnly, renderableKeys, visibleKeys]
	)

	const back = useCallback(async () => {
		if (step) {
			await moveFreely(null, step.key, -1)
		}
	}, [moveFreely, step])

	/**
	 * Whether a step opens on a click. `free` opens any of them; `linear` opens the ones behind
	 * the current step and the ones already visited, whose validation and gate have run.
	 */
	const canGoTo = useCallback(
		(key: string): boolean => {
			const target = steps.findIndex((candidate) => candidate.key === key)
			if (target < 0 || key === currentKey) {
				return false
			}
			return variant.navigation === 'free' || target < index || visited.has(key)
		},
		[currentKey, index, steps, variant.navigation, visited]
	)

	const goTo = useCallback(
		async (key: string) => {
			if (step && canGoTo(key)) {
				await moveFreely(key, step.key, 1)
			}
		},
		[canGoTo, moveFreely, step]
	)

	const guard = computeSaveGuard({
		blockedMessage,
		finished: outcome !== null,
		isLast,
		readOnly,
		save: variant.save,
	})

	const save = useCallback(async () => {
		if (!guard.allowed) {
			return
		}
		if (collectionConfig && hasDraftsEnabled(collectionConfig)) {
			if (hasPublishPermission) {
				await submit({ overrides: { _status: 'published' } })
			} else {
				await submit({ overrides: { _status: 'draft' }, skipValidation: true })
			}
			return
		}
		await submit()
	}, [collectionConfig, guard.allowed, hasPublishPermission, submit])

	// Ctrl+S saves wherever the guard allows it and is swallowed elsewhere, so the browser's
	// own save dialog never opens over the form.
	useHotkey({ cmdCtrlKey: true, editDepth, keyCodes: ['s'] }, (event) => {
		event.preventDefault()
		event.stopPropagation()
		if (guard.allowed && !busy && (modified || !id)) {
			void save()
		}
	})

	const onBeforeNext = useCallback((handler: BeforeNextHandler) => {
		handlersRef.current.add(handler)
		return () => {
			handlersRef.current.delete(handler)
		}
	}, [])

	const allowSave = useCallback(() => setBlockedMessage(null), [])
	const blockSave = useCallback((reason: string) => setBlockedMessage(reason), [])
	// Ending without a save discards the entered values on purpose, so leaving afterwards
	// must not ask about unsaved changes.
	const finish = useCallback(
		(result: Outcome) => {
			setModified(false)
			setOutcome(result)
		},
		[setModified, setOutcome]
	)

	const value = useMemo<WizardContextValue>(
		() => ({
			allowSave,
			back,
			blockSave,
			canGoTo,
			busy,
			count: steps.length,
			error,
			errorCount,
			finish,
			goTo,
			index,
			isFirst: index <= 0,
			isLast,
			message,
			next,
			onBeforeNext,
			primaryAction,
			readOnly,
			save,
			saveAllowed: guard.allowed,
			saveBlockedMessage: blockedMessage,
			saveBlockedReason: guard.reason,
			setMessage,
			setPrimaryAction,
			step,
			steps,
			variant,
		}),
		[
			allowSave,
			back,
			blockSave,
			blockedMessage,
			canGoTo,
			busy,
			error,
			errorCount,
			finish,
			goTo,
			guard.allowed,
			guard.reason,
			index,
			isLast,
			message,
			next,
			onBeforeNext,
			primaryAction,
			readOnly,
			save,
			setMessage,
			setPrimaryAction,
			step,
			steps,
			variant,
		]
	)

	const variantSlots = slots.variants[variant.key]
	const slotLevels = useMemo(
		() => [
			step ? variantSlots?.steps[step.key] : undefined,
			variantSlots?.variant,
			slots.collection,
			slots.plugin,
		],
		[slots.collection, slots.plugin, step, variantSlots]
	)
	const progressVisible = steps.length > 1 && resolveSlot('Progress', slotLevels) !== false
	const internals = useMemo<RunnerInternals>(
		() => ({ beforeSteps, progressVisible, rendered, slotLevels }),
		[beforeSteps, progressVisible, rendered, slotLevels]
	)

	const layout = resolveSlot('Layout', slotLevels)

	return (
		<WizardContext value={value}>
			<RunnerInternalsContext value={internals}>
				{header}
				{outcome === null && layout !== undefined ? layout : <DefaultLayout />}
			</RunnerInternalsContext>
		</WizardContext>
	)
}
