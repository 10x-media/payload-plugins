'use client'

import {
	useConfig,
	useDocumentInfo,
	useEditDepth,
	useForm,
	useFormFields,
	useFormModified,
	useHotkey,
	useServerFunctions,
} from '@payloadcms/ui'
import type { FormState, JsonObject } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { STEP_PARAM } from '../plugin/constants'
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
import { resolveStepKey, stepIsRenderable, stepIsValid, stepPaths, visibleSteps } from './steps'
import type { ClientVariant, Outcome, RenderedSlots, VariantProviderProps } from './types'
import { replaceParam } from './url'

type RunnerProps = VariantProviderProps & {
	/** Rendered above the steps: the upload area on upload collections. */
	beforeSteps: React.ReactNode
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
	const { beforeSteps, header, readOnly, rendered, slots, variant } = props
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
	const editDepth = useEditDepth()
	const modified = useFormModified()

	const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(
		() => new Set(variant.steps.filter((step) => step.initiallyVisible).map((step) => step.key))
	)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<null | string>(null)
	const [blockedMessage, setBlockedMessage] = useState<null | string>(null)
	const [override, setOverride] = useState<StepOverride>({
		action: null,
		message: null,
		stepKey: null,
	})
	const handlersRef = useRef(new Set<BeforeNextHandler>())
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
		if (!inDrawer) {
			replaceParam(STEP_PARAM, currentKey)
		}
	}, [currentKey, inDrawer, setStepKey, stepKey])

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
		(phase: 'gate' | 'visibility', gateStep?: string) =>
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
			}),
		[apiRoute, collectionSlug, getData, id, inDrawer, serverURL, variant.key]
	)

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

	const goTo = useCallback(
		async (key: string) => {
			if (
				step &&
				(variant.navigation === 'free' || steps.findIndex((s) => s.key === key) < index)
			) {
				await moveFreely(key, step.key, 1)
			}
		},
		[index, moveFreely, step, steps, variant.navigation]
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
			busy,
			count: steps.length,
			error,
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
			busy,
			error,
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
