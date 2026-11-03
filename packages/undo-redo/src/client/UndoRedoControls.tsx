'use client'
import { Button, useFormProcessing } from '@payloadcms/ui'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { ControlsClientProps } from '../plugin/options'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatShortcut, isMacPlatform } from './formatShortcut'
import { HistoryDebugOverlay } from './HistoryDebugOverlay'
import { useUndoRedo } from './useUndoRedo'
import './undoRedoControls.css'

const baseClass = 'undo-redo-controls'

/**
 * Resolved after mount rather than during render: the server render has no
 * `navigator`, so deciding there would either hydrate into a mismatch or lock
 * every user to the non-mac notation. The value only feeds tooltip text, which
 * nobody can hover before the first paint.
 */
const useIsMac = (): boolean => {
	const [isMac, setIsMac] = useState(false)
	useEffect(() => setIsMac(isMacPlatform()), [])
	return isMac
}

/**
 * Lucide's undo, redo and history glyphs at the scale of Payload's own icon
 * buttons: Lucide `size={16}` with `absoluteStrokeWidth` and a 1px stroke, which
 * puts a 12px glyph drawn in 1px lines inside the button, like the document
 * menu's icon next to it.
 */
const ICON_SIZE = 16
const ICON_STROKE = (24 / ICON_SIZE) * 1

const LucideIcon: React.FC<{ children: React.ReactNode; name: string }> = ({ children, name }) => (
	<svg
		aria-hidden="true"
		className={`icon icon--${name}`}
		fill="none"
		height={ICON_SIZE}
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth={ICON_STROKE}
		viewBox="0 0 24 24"
		width={ICON_SIZE}
	>
		{children}
	</svg>
)

const UndoIcon: React.FC = () => (
	<LucideIcon name="undo">
		<path d="M3 7v6h6" />
		<path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
	</LucideIcon>
)

const RedoIcon: React.FC = () => (
	<LucideIcon name="redo">
		<path d="M21 7v6h-6" />
		<path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
	</LucideIcon>
)

const HistoryIcon: React.FC = () => (
	<LucideIcon name="history">
		<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
		<path d="M3 3v5h5" />
		<path d="M12 7v5l4 2" />
	</LucideIcon>
)

/**
 * Every setting is optional so the component stays usable when a host mounts it
 * by hand (`autoMount: false`) rather than through the plugin, which always
 * passes a fully resolved set.
 */
export type UndoRedoControlsProps = Partial<ControlsClientProps>

/**
 * Undo/redo buttons for the document edit view. Thin presentation over
 * `useUndoRedo`, which owns the history: a host that wants different markup can
 * call that hook directly instead of restyling this.
 */
export const UndoRedoControls: React.FC<UndoRedoControlsProps> = (props) => {
	const { debug = false } = props
	const {
		canRedo,
		canUndo,
		chords,
		fields,
		history,
		jumpTo,
		redo,
		revision,
		tracksSavedState,
		undo,
	} = useUndoRedo(props)
	const processing = useFormProcessing()
	const { t } = useTranslation()
	const isMac = useIsMac()
	const [overlayOpen, setOverlayOpen] = useState(false)

	/**
	 * Button labels, and the same labels with the bound chord appended for the
	 * tooltip. Only the first chord is shown: the rest are aliases for the same
	 * action, and listing them turns a hint into something to read.
	 *
	 * The shortcut stays out of the accessible name on purpose, since a screen
	 * reader announces `⇧⌘Z` as punctuation rather than as a key combination.
	 */
	const labels = useMemo(() => {
		const withChord = (label: string, chord: string | undefined) => {
			const hint = chord ? formatShortcut(chord, isMac) : ''
			return hint ? `${label} (${hint})` : label
		}
		const undoLabel = t(keys.undo)
		const redoLabel = t(keys.redo)
		return {
			redo: redoLabel,
			redoTooltip: withChord(redoLabel, chords?.redo[0]),
			undo: undoLabel,
			undoTooltip: withChord(undoLabel, chords?.undo[0]),
		}
	}, [chords, isMac, t])

	return (
		<div className={baseClass}>
			<Button
				aria-label={labels.undo}
				buttonStyle="ghost"
				className={`${baseClass}__button ${baseClass}__undo`}
				disabled={!canUndo || processing}
				icon={<UndoIcon />}
				margin={false}
				onClick={undo}
				size="medium"
				tooltip={labels.undoTooltip}
			/>
			<Button
				aria-label={labels.redo}
				buttonStyle="ghost"
				className={`${baseClass}__button ${baseClass}__redo`}
				disabled={!canRedo || processing}
				icon={<RedoIcon />}
				margin={false}
				onClick={redo}
				size="medium"
				tooltip={labels.redoTooltip}
			/>
			{debug ? (
				<Button
					aria-expanded={overlayOpen}
					aria-label={t(keys.debug)}
					buttonStyle="ghost"
					className={`${baseClass}__button ${baseClass}__debug`}
					icon={<HistoryIcon />}
					margin={false}
					onClick={() => setOverlayOpen((open) => !open)}
					selected={overlayOpen}
					size="medium"
					tooltip={t(keys.debugTooltip)}
				/>
			) : null}
			{debug && overlayOpen ? (
				<HistoryDebugOverlay
					fields={fields}
					history={history}
					onClose={() => setOverlayOpen(false)}
					onJump={jumpTo}
					revision={revision}
					tracksSavedState={tracksSavedState}
				/>
			) : null}
		</div>
	)
}
