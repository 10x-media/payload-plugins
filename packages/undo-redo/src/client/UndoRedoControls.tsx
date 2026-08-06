'use client'
import {
	Button,
	useAllFormFields,
	useForm,
	useFormInitializing,
	useFormProcessing,
} from '@payloadcms/ui'
import type { FormState } from 'payload'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
	buildRestoreState,
	canRedo,
	canUndo,
	createHistory,
	pushSnapshot,
} from '../history/historyCore'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { HistoryDebugOverlay } from './HistoryDebugOverlay'

const baseClass = 'undo-redo-controls'

/**
 * Snapshot debounce. Rapid consecutive edits (typing) coalesce into one
 * history entry; structural edits (row delete/move) are far enough apart
 * in practice to land in their own entries.
 *
 * Echoes of our own restores (the form's post-restore onChange/server merge)
 * need no time-based suppression: they compare equal to the entry at the
 * current history index and are absorbed by the dedupe in pushSnapshot, while
 * hook-derived fields that servers rewrite (pathname, breadcrumbs, sessions)
 * are excluded from the comparison entirely (see historyCore IGNORED_ROOTS).
 */
const CAPTURE_DEBOUNCE_MS = 400

/**
 * Editing surfaces own their keyboard undo: native inputs use the browser's
 * text undo, Lexical rich text uses its internal history plugin.
 */
const isTextEditingTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const UndoIcon: React.FC = () => (
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M3 7v6h6" />
		<path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
	</svg>
)

const RedoIcon: React.FC = () => (
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M21 7v6h-6" />
		<path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
	</svg>
)

const HistoryIcon: React.FC = () => (
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
		<path d="M3 3v5h5" />
		<path d="M12 7v5l3 2" />
	</svg>
)

export interface UndoRedoControlsProps {
	/**
	 * Render the history inspector toggle. Set from the plugin's `debug` option
	 * and passed through as a client prop, so production builds never mount the
	 * overlay or pay for its per-capture re-render.
	 */
	debug?: boolean
}

/**
 * Undo/redo buttons for the document edit view. Keeps a client-side history of
 * form-state snapshots, independent of Payload's document versions: nothing is
 * read from or written to the server until the user saves.
 */
export const UndoRedoControls: React.FC<UndoRedoControlsProps> = ({ debug = false }) => {
	const [fields, dispatchFields] = useAllFormFields()
	const { setModified } = useForm()
	const initializing = useFormInitializing()
	const processing = useFormProcessing()
	const { t } = useTranslation()

	const historyRef = useRef(createHistory())
	const fieldsRef = useRef<FormState | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const [flags, setFlags] = useState({ redo: false, undo: false })
	const [overlayOpen, setOverlayOpen] = useState(false)
	/**
	 * Forces the debug overlay to re-read the mutable history object, which is a
	 * ref and therefore invisible to React. Only bumped under `debug`, so the
	 * default build keeps re-rendering purely on the undo/redo flags.
	 */
	const [revision, setRevision] = useState(0)

	fieldsRef.current = fields

	const bumpRevision = useCallback(() => {
		if (debug) setRevision((n) => n + 1)
	}, [debug])

	const refreshFlags = useCallback(() => {
		const history = historyRef.current
		const next = { redo: canRedo(history), undo: canUndo(history) }
		setFlags((prev) => (prev.undo === next.undo && prev.redo === next.redo ? prev : next))
	}, [])

	// Debug/e2e handle: lets tests inspect the history without reaching into React.
	useEffect(() => {
		const win = window as Window & { __payloadUndoHistory?: typeof historyRef.current }
		win.__payloadUndoHistory = historyRef.current
		return () => {
			delete win.__payloadUndoHistory
		}
	}, [])

	useEffect(() => {
		if (initializing || !fields || Object.keys(fields).length === 0) return
		const timer = setTimeout(() => {
			const latest = fieldsRef.current
			if (!latest) return
			if (pushSnapshot(historyRef.current, latest)) bumpRevision()
			refreshFlags()
		}, CAPTURE_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [fields, initializing, refreshFlags, bumpRevision])

	/**
	 * Restore the entry that `resolveTarget` picks. The target is resolved from
	 * the index *after* capturing pending edits, not before: capturing can move
	 * the index, and a relative step must be relative to where the user is.
	 */
	const applyRestore = useCallback(
		(resolveTarget: (indexAfterCapture: number) => number) => {
			const history = historyRef.current
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
				state: buildRestoreState(entry, current),
				optimize: false,
			})
			// Mark the form modified so the debounced onChange revalidates the
			// restored state on the server and autosave/save picks it up.
			setModified(true)
			history.index = target
			refreshFlags()
			bumpRevision()
		},
		[bumpRevision, dispatchFields, refreshFlags, setModified]
	)

	const restore = useCallback(
		(direction: -1 | 1) => applyRestore((index) => index + direction),
		[applyRestore]
	)

	const jumpTo = useCallback((index: number) => applyRestore(() => index), [applyRestore])

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return
			const key = e.key.toLowerCase()
			const isUndo = key === 'z' && !e.shiftKey
			const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
			if (!isUndo && !isRedo) return
			if (isTextEditingTarget(e.target)) return
			// Multiple edit forms can be mounted at once (document drawers).
			// Only the instance belonging to the form the event happened in,
			// or, for events outside any form, the topmost open drawer, reacts.
			const ourForm = rootRef.current?.closest('form')
			const targetForm = e.target instanceof HTMLElement ? e.target.closest('form') : null
			if (targetForm) {
				if (targetForm !== ourForm) return
			} else {
				const openDrawers = document.querySelectorAll('.drawer--is-open')
				const topDrawer = openDrawers[openDrawers.length - 1]
				if (topDrawer && ourForm && !topDrawer.contains(ourForm)) return
			}
			e.preventDefault()
			restore(isUndo ? -1 : 1)
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [restore])

	return (
		<div
			ref={rootRef}
			className={baseClass}
			style={{ alignItems: 'center', display: 'flex', gap: '4px' }}
		>
			<Button
				// aria-label={t(keys.undo)}
				buttonStyle={!flags.undo || processing ? 'dashed' : 'subtle'}
				className={`${baseClass}__undo`}
				disabled={!flags.undo || processing}
				margin={false}
				onClick={() => restore(-1)}
				size="small"
				tooltip={t(keys.undoTooltip)}
			>
				<UndoIcon />
			</Button>
			<Button
				// aria-label in payload button components also goes to the title attribute
				// Which messes up tooltips in the admin panel (title renders above tooltip,
				// so essentially hovering over the button shows the title, and tooltip is mostly hidden)
				// aria-label={t(keys.redo)}
				buttonStyle={!flags.redo || processing ? 'dashed' : 'subtle'}
				className={`${baseClass}__redo`}
				disabled={!flags.redo || processing}
				margin={false}
				onClick={() => restore(1)}
				size="small"
				tooltip={t(keys.redoTooltip)}
			>
				<RedoIcon />
			</Button>
			{debug ? (
				<Button
					aria-label={t(keys.debug)}
					buttonStyle={overlayOpen ? 'secondary' : 'pill'}
					className={`${baseClass}__debug`}
					margin={false}
					onClick={() => setOverlayOpen((open) => !open)}
					size="small"
					tooltip={t(keys.debugTooltip)}
				>
					<HistoryIcon />
				</Button>
			) : null}
			{debug && overlayOpen ? (
				<HistoryDebugOverlay
					fields={fields}
					history={historyRef.current}
					onClose={() => setOverlayOpen(false)}
					onJump={jumpTo}
					revision={revision}
				/>
			) : null}
		</div>
	)
}
