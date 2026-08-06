'use client'
import {
	Button,
	useAllFormFields,
	useConfig,
	useDocumentInfo,
	useForm,
	useFormInitializing,
	useFormProcessing,
} from '@payloadcms/ui'
import type { FormState } from 'payload'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import {
	buildRestoreState,
	canRedo,
	canUndo,
	createHistory,
	MAX_HISTORY_ENTRIES,
	pushSnapshot,
	type UndoHistory,
} from '../history/historyCore'
import { createPathMatcher } from '../history/pathPatterns'
import {
	type ControlsClientProps,
	DEFAULT_CAPTURE_DEBOUNCE_MS,
	DEFAULT_SHORTCUTS,
} from '../plugin/options'
import { buildFieldSchemaMap, collectIgnorePatterns } from '../schema/fieldSchema'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { HistoryDebugOverlay } from './HistoryDebugOverlay'

const baseClass = 'undo-redo-controls'

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

/**
 * Every setting is optional so the component stays usable when a host mounts it
 * by hand (`autoMount: false`) rather than through the plugin, which always
 * passes a fully resolved set.
 */
export type UndoRedoControlsProps = Partial<ControlsClientProps>

/**
 * Undo/redo buttons for the document edit view. Keeps a client-side history of
 * form-state snapshots, independent of Payload's document versions: nothing is
 * read from or written to the server until the user saves.
 */
export const UndoRedoControls: React.FC<UndoRedoControlsProps> = ({
	captureDebounce = DEFAULT_CAPTURE_DEBOUNCE_MS,
	debug = false,
	ignoreFieldTypes,
	ignorePaths,
	maxHistory = MAX_HISTORY_ENTRIES,
	shortcuts,
}) => {
	const [fields, dispatchFields] = useAllFormFields()
	const { setModified } = useForm()
	const initializing = useFormInitializing()
	const processing = useFormProcessing()
	const { t } = useTranslation()
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
	const isIgnored = useMemo(() => {
		const entity = collectionSlug
			? getEntityConfig({ collectionSlug })
			: globalSlug
				? getEntityConfig({ globalSlug })
				: null
		const schemaPatterns = entity
			? collectIgnorePatterns(
					buildFieldSchemaMap(entity.fields, { blocksMap: config.blocksMap }),
					ignoreFieldTypes
				)
			: []
		return createPathMatcher([...(ignorePaths ?? []), ...schemaPatterns])
	}, [collectionSlug, config.blocksMap, getEntityConfig, globalSlug, ignoreFieldTypes, ignorePaths])

	const historyRef = useRef<UndoHistory | null>(null)
	if (historyRef.current === null) {
		historyRef.current = createHistory({ isIgnored, maxHistory })
	}
	const history = historyRef.current
	// Kept in sync rather than rebuilt, so changing a setting cannot silently
	// drop the entries the editor has already accumulated.
	history.options = { isIgnored, maxHistory }

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
			if (pushSnapshot(history, latest)) bumpRevision()
			refreshFlags()
		}, captureDebounce)
		return () => clearTimeout(timer)
	}, [captureDebounce, fields, history, initializing, refreshFlags, bumpRevision])

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
			// Mark the form modified so the debounced onChange revalidates the
			// restored state on the server and autosave/save picks it up.
			setModified(true)
			history.index = target
			refreshFlags()
			bumpRevision()
		},
		[bumpRevision, dispatchFields, history, isIgnored, refreshFlags, setModified]
	)

	const restore = useCallback(
		(direction: -1 | 1) => applyRestore((index) => index + direction),
		[applyRestore]
	)

	const jumpTo = useCallback((index: number) => applyRestore(() => index), [applyRestore])

	/**
	 * Several edit forms can be mounted at once (document drawers). Only the
	 * instance belonging to the form the event happened in reacts; for events
	 * outside any form, the topmost open drawer wins.
	 *
	 * Text-editing surfaces need no check here: react-hotkeys-hook skips form
	 * tags and contenteditable by default, which is exactly the rule we want,
	 * since native inputs own the browser's text undo and Lexical owns its own.
	 */
	const isForAnotherForm = useCallback((e: KeyboardEvent): boolean => {
		const ourForm = rootRef.current?.closest('form')
		const targetForm = e.target instanceof HTMLElement ? e.target.closest('form') : null
		if (targetForm) return targetForm !== ourForm
		const openDrawers = document.querySelectorAll('.drawer--is-open')
		const topDrawer = openDrawers[openDrawers.length - 1]
		return Boolean(topDrawer && ourForm && !topDrawer.contains(ourForm))
	}, [])

	const hotkeyOptions = useMemo(
		() => ({
			enabled: shortcuts !== false,
			ignoreEventWhen: isForAnotherForm,
			preventDefault: true,
		}),
		[isForAnotherForm, shortcuts]
	)

	useHotkeys(
		shortcuts === false ? [] : (shortcuts?.undo ?? DEFAULT_SHORTCUTS.undo),
		() => {
			restore(-1)
		},
		hotkeyOptions,
		[restore]
	)

	useHotkeys(
		shortcuts === false ? [] : (shortcuts?.redo ?? DEFAULT_SHORTCUTS.redo),
		() => {
			restore(1)
		},
		hotkeyOptions,
		[restore]
	)

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
					history={history}
					onClose={() => setOverlayOpen(false)}
					onJump={jumpTo}
					revision={revision}
				/>
			) : null}
		</div>
	)
}
