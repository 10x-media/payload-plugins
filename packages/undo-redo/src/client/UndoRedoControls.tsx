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
				buttonStyle="subtle"
				className={`${baseClass}__button ${baseClass}__undo`}
				disabled={!canUndo || processing}
				// Button's own `aria-label` prop is also written to `title`, and the
				// native title tooltip then covers Payload's. Going through
				// `extraButtonProps`, which is spread last, sets the accessible name
				// without the title.
				extraButtonProps={{ 'aria-label': labels.undo }}
				margin={false}
				onClick={undo}
				tooltip={labels.undoTooltip}
			>
				<UndoIcon />
			</Button>
			<Button
				buttonStyle="subtle"
				className={`${baseClass}__button ${baseClass}__redo`}
				disabled={!canRedo || processing}
				extraButtonProps={{ 'aria-label': labels.redo }}
				margin={false}
				onClick={redo}
				tooltip={labels.redoTooltip}
			>
				<RedoIcon />
			</Button>
			{debug ? (
				<Button
					buttonStyle="subtle"
					className={[
						`${baseClass}__button`,
						`${baseClass}__debug`,
						overlayOpen ? `${baseClass}__button--active` : '',
					]
						.filter(Boolean)
						.join(' ')}
					extraButtonProps={{ 'aria-expanded': overlayOpen, 'aria-label': t(keys.debug) }}
					margin={false}
					onClick={() => setOverlayOpen((open) => !open)}
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
					tracksSavedState={tracksSavedState}
				/>
			) : null}
		</div>
	)
}
