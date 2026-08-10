'use client'
import {
	useAllFormFields,
	useConfig,
	useDocumentInfo,
	useForm,
	useFormInitializing,
	useFormModified,
} from '@payloadcms/ui'
import type { FormState } from 'payload'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import {
	buildRestoreState,
	canRedo,
	canUndo,
	createHistory,
	isAtSavedState,
	MAX_HISTORY_ENTRIES,
	markSaved,
	pushSnapshot,
	type UndoHistory,
} from '../history/historyCore'
import { createPathMatcher } from '../history/pathPatterns'
import { createVolatileMatcher } from '../history/volatileValues'
import {
	type ControlsClientProps,
	DEFAULT_CAPTURE_DEBOUNCE_MS,
	DEFAULT_SHORTCUTS,
} from '../plugin/options'
import {
	buildFieldSchemaMap,
	collectIgnorePatterns,
	type FieldSchemaMap,
} from '../schema/fieldSchema'

/** Shared so a document without a resolvable schema keeps a stable identity. */
const EMPTY_SCHEMA: FieldSchemaMap = new Map()

/**
 * Every setting is optional so the hook stays usable when a host calls it by
 * hand rather than through the plugin, which always passes a fully resolved set.
 */
export type UseUndoRedoOptions = Partial<ControlsClientProps>

/** The chords actually bound, or null when keyboard handling is off. */
export interface BoundChords {
	undo: string[]
	redo: string[]
}

export interface UseUndoRedoResult {
	/** True when there is an earlier entry to step back to. */
	canUndo: boolean
	/** True when there is a later entry to step forward to. */
	canRedo: boolean
	undo: () => void
	redo: () => void
	/** Restore the entry at `index` in `history.stack`. Out-of-range indexes no-op. */
	jumpTo: (index: number) => void
	/** Live form state, as `useAllFormFields` reports it. */
	fields: FormState
	/**
	 * The mutable history object backing this instance.
	 *
	 * Exposed so a custom control can mount `<HistoryDebugOverlay />` or inspect
	 * the stack. It is an internal structure, not a stable contract: treat it as
	 * read-only and expect its shape to change in a minor release.
	 */
	history: UndoHistory
	/**
	 * Counter bumped on every capture and restore. Only moves when `debug` is on,
	 * since it exists to pull the mutable history into React's render cycle for
	 * the inspector and nothing else needs the re-renders.
	 */
	revision: number
	/** False under autosave, where the saved baseline is deliberately not tracked. */
	tracksSavedState: boolean
	/** Resolved keyboard chords, for labelling. Null when `shortcuts` is false. */
	chords: BoundChords | null
}

/**
 * Undo/redo for the surrounding Payload form: a client-side history of
 * form-state snapshots, independent of Payload's document versions, with
 * nothing read from or written to the server until the user saves.
 *
 * Backs `<UndoRedoControls />` and is exported so a host can build its own
 * controls instead (pair it with `autoMount: false`). Must be called from
 * inside a document edit form; outside one it finds no fields and stays
 * disabled.
 *
 * One history per call. Two instances on the same form keep two independent
 * stacks and each captures the other's restores as fresh edits, so mount either
 * ours or yours, not both.
 */
export const useUndoRedo = ({
	captureDebounce = DEFAULT_CAPTURE_DEBOUNCE_MS,
	debug = false,
	ignoreFieldTypes,
	ignorePaths,
	maxHistory = MAX_HISTORY_ENTRIES,
	shortcuts,
}: UseUndoRedoOptions = {}): UseUndoRedoResult => {
	const [fields, dispatchFields] = useAllFormFields()
	const { formRef, setModified } = useForm()
	const initializing = useFormInitializing()
	const modified = useFormModified()
	const { getEntityConfig, config } = useConfig()
	const { collectionSlug, globalSlug } = useDocumentInfo()

	/**
	 * Ignore patterns from the config, plus the ones derived from the document's
	 * own schema: fields the host opted out through `admin.custom`, and every
	 * field of an excluded type. The schema is the only place a mounted
	 * component can learn field types, since form state omits them unless
	 * `buildFormState` was called with `includeSchema`, which the edit view never
	 * does.
	 */
	const entity = useMemo(
		() =>
			collectionSlug
				? getEntityConfig({ collectionSlug })
				: globalSlug
					? getEntityConfig({ globalSlug })
					: null,
		[collectionSlug, getEntityConfig, globalSlug]
	)

	/**
	 * Autosave persists every edit continuously, so "differs from what is
	 * persisted" is not a state the editor can meaningfully be in: the baseline
	 * would move on every autosave, and an undo would immediately trigger one and
	 * move it again. Tracking it there produces a saved marker that chases the
	 * user around instead of telling them anything, so the whole baseline
	 * mechanism is skipped and restores simply report the form as modified.
	 */
	const tracksSavedState = useMemo(() => {
		const drafts = entity?.versions?.drafts
		const autosave = typeof drafts === 'object' && drafts !== null ? drafts.autosave : false
		return !autosave
	}, [entity])

	const schema = useMemo(
		() =>
			entity ? buildFieldSchemaMap(entity.fields, { blocksMap: config.blocksMap }) : EMPTY_SCHEMA,
		[config.blocksMap, entity]
	)

	const isIgnored = useMemo(
		() =>
			createPathMatcher([
				...(ignorePaths ?? []),
				...collectIgnorePatterns(schema, ignoreFieldTypes),
			]),
		[ignoreFieldTypes, ignorePaths, schema]
	)

	const isVolatile = useMemo(() => createVolatileMatcher(schema), [schema])

	const historyRef = useRef<UndoHistory | null>(null)
	if (historyRef.current === null) {
		historyRef.current = createHistory({ isIgnored, isVolatile, maxHistory })
	}
	const history = historyRef.current
	// Kept in sync rather than rebuilt, so changing a setting cannot silently
	// drop the entries the editor has already accumulated. Assigned during render
	// on purpose: an effect would leave a restore triggered between render and
	// commit reading the settings the user has just replaced.
	history.options = { isIgnored, isVolatile, maxHistory }

	const fieldsRef = useRef<FormState | null>(null)
	const [flags, setFlags] = useState({ redo: false, undo: false })
	/**
	 * Forces consumers to re-read the mutable history object, which is a ref and
	 * therefore invisible to React. Only bumped under `debug`, so the default
	 * build keeps re-rendering purely on the undo/redo flags.
	 */
	const [revision, setRevision] = useState(0)

	fieldsRef.current = fields

	const bumpRevision = useCallback(() => {
		if (debug) setRevision((n) => n + 1)
	}, [debug])

	const refreshFlags = useCallback(() => {
		const next = { redo: canRedo(history), undo: canUndo(history) }
		setFlags((prev) => (prev.undo === next.undo && prev.redo === next.redo ? prev : next))
	}, [history])

	// Debug/e2e handle: lets tests inspect the history without reaching into React.
	useEffect(() => {
		const win = window as Window & { __payloadUndoHistory?: UndoHistory }
		win.__payloadUndoHistory = history
		return () => {
			delete win.__payloadUndoHistory
		}
	}, [history])

	useEffect(() => {
		if (initializing || !fields || Object.keys(fields).length === 0) return
		const timer = setTimeout(() => {
			const latest = fieldsRef.current
			if (!latest) return
			// Bumped whether or not an entry was appended: a capture that folds
			// into the current entry changes what the inspector is showing just as
			// much as one that adds a row to it.
			pushSnapshot(history, latest)
			bumpRevision()
			refreshFlags()
		}, captureDebounce)
		return () => clearTimeout(timer)
	}, [captureDebounce, fields, history, initializing, refreshFlags, bumpRevision])

	/**
	 * Set when this instance is the one clearing `modified`, which happens when a
	 * restore lands back on the saved state.
	 *
	 * The baseline is already correct in that case, by definition: the restore
	 * only reports clean because the entry it landed on matches the baseline.
	 * Re-recording it there reads live form state while the server merge that
	 * follows REPLACE_STATE is still in flight, so the baseline lands on a state
	 * that matches no entry, and moves again once the merge settles.
	 */
	const clearedByRestoreRef = useRef(false)

	/**
	 * Re-baseline on every point Payload itself considers the form clean: a
	 * successful save or autosave, a reset, and the initial load. Reading
	 * Payload's own flag rather than watching for a save keeps the baseline
	 * correct for all of them without re-deriving what "saved" means.
	 *
	 * This records a baseline and deliberately does not touch the stack. Pushing
	 * here would run the redo-tail truncation in pushSnapshot, and since redoing
	 * onto the saved state makes the form clean, it would destroy the very branch
	 * redo had just stepped into.
	 */
	useEffect(() => {
		if (!tracksSavedState) return
		if (modified) {
			clearedByRestoreRef.current = false
			return
		}
		if (initializing || !fieldsRef.current) return
		if (clearedByRestoreRef.current) {
			clearedByRestoreRef.current = false
			return
		}
		markSaved(history, fieldsRef.current)
		bumpRevision()
	}, [bumpRevision, history, initializing, modified, tracksSavedState])

	/**
	 * Restore the entry that `resolveTarget` picks. The target is resolved from
	 * the index *after* capturing pending edits, not before: capturing can move
	 * the index, and a relative step must be relative to where the user is.
	 */
	const applyRestore = useCallback(
		(resolveTarget: (indexAfterCapture: number) => number) => {
			const current = fieldsRef.current
			if (!current) return
			// Capture pending (not yet debounced) edits first so undo steps back
			// from what the user actually sees, not from the last capture. Echoes
			// of a previous restore dedupe against the current entry and no-op.
			pushSnapshot(history, current)
			const target = resolveTarget(history.index)
			const entry = history.stack[target]
			if (!entry) {
				refreshFlags()
				bumpRevision()
				return
			}
			dispatchFields({
				type: 'REPLACE_STATE',
				state: buildRestoreState(entry, current, isIgnored),
				optimize: false,
			})
			history.index = target
			// Modified drives the "leave without saving" prompt and the save
			// button, so it has to answer "does the form differ from what is
			// persisted", not "did something just happen". Landing back on the
			// saved entry is a return to clean; anywhere else is a real change,
			// and marking it also makes the debounced onChange revalidate the
			// restored state on the server so save and autosave pick it up.
			const clean = tracksSavedState && isAtSavedState(history)
			clearedByRestoreRef.current = clean
			setModified(!clean)
			refreshFlags()
			bumpRevision()
		},
		[bumpRevision, dispatchFields, history, isIgnored, refreshFlags, setModified, tracksSavedState]
	)

	const restore = useCallback(
		(direction: -1 | 1) => applyRestore((index) => index + direction),
		[applyRestore]
	)

	const undo = useCallback(() => restore(-1), [restore])
	const redo = useCallback(() => restore(1), [restore])
	const jumpTo = useCallback((index: number) => applyRestore(() => index), [applyRestore])

	/**
	 * Several edit forms can be mounted at once (document drawers). Only the
	 * instance belonging to the form the event happened in reacts; for events
	 * outside any form, the topmost open drawer wins.
	 *
	 * The form element comes from Payload's own form context rather than from a
	 * DOM ref of our own, so the rule holds wherever a host renders its controls,
	 * including outside the element it is scoping.
	 *
	 * Text-editing surfaces need no check here: react-hotkeys-hook skips form
	 * tags and contenteditable by default, which is exactly the rule we want,
	 * since native inputs own the browser's text undo and Lexical owns its own.
	 */
	const isForAnotherForm = useCallback(
		(e: KeyboardEvent): boolean => {
			const ourForm = formRef?.current
			const target = e.target instanceof HTMLElement ? e.target : null
			if (target && ourForm?.contains(target)) return false
			const targetForm = target?.closest('form')
			if (targetForm) return targetForm !== ourForm
			const openDrawers = document.querySelectorAll('.drawer--is-open')
			const topDrawer = openDrawers[openDrawers.length - 1]
			return Boolean(topDrawer && ourForm && !topDrawer.contains(ourForm))
		},
		[formRef]
	)

	const chords = useMemo(() => {
		if (shortcuts === false) return null
		return {
			redo: shortcuts?.redo ?? [...DEFAULT_SHORTCUTS.redo],
			undo: shortcuts?.undo ?? [...DEFAULT_SHORTCUTS.undo],
		}
	}, [shortcuts])

	const hotkeyOptions = useMemo(
		() => ({
			enabled: chords !== null,
			ignoreEventWhen: isForAnotherForm,
			preventDefault: true,
		}),
		[chords, isForAnotherForm]
	)

	useHotkeys(chords?.undo ?? [], undo, hotkeyOptions, [undo])

	useHotkeys(chords?.redo ?? [], redo, hotkeyOptions, [redo])

	return {
		canRedo: flags.redo,
		canUndo: flags.undo,
		chords,
		fields,
		history,
		jumpTo,
		redo,
		revision,
		tracksSavedState,
		undo,
	}
}
