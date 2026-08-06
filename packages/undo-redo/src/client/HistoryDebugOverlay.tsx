'use client'
import type { FormState } from 'payload'
import type React from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import {
	type ComparableDiff,
	deepEqual,
	diffComparable,
	extractComparable,
	isAtSavedState,
	type UndoHistory,
} from '../history/historyCore'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './historyDebugOverlay.css'

const baseClass = 'undo-redo-debug'

/** Longest rendered form of a value before it is elided in the diff table. */
const MAX_VALUE_CHARS = 120

/**
 * One-line rendering of an arbitrary form value. Rich text and other deep
 * objects collapse to a truncated JSON string: the overlay answers "did this
 * path change and roughly to what", not "what is the full document".
 */
const formatValue = (value: unknown): string => {
	if (value === undefined) return '∅'
	if (value === null) return 'null'
	if (typeof value === 'string') return value === '' ? "''" : value
	let text: string
	try {
		text = JSON.stringify(value) ?? String(value)
	} catch {
		text = String(value)
	}
	return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

/** Row ids shortened to their last segment so moves stay readable in one line. */
const formatRowIds = (ids: (string | undefined)[] | undefined): string =>
	ids === undefined ? '∅' : `[${ids.map((id) => id?.slice(-4) ?? '?').join(', ')}]`

const DiffRows: React.FC<{ diffs: ComparableDiff[] }> = ({ diffs }) => (
	<table className={`${baseClass}__diff`}>
		<tbody>
			{diffs.map((diff) => (
				<tr key={diff.path}>
					<td className={`${baseClass}__path`}>
						{diff.path}
						{diff.presence ? (
							<span className={`${baseClass}__presence`}>{diff.presence}</span>
						) : null}
					</td>
					<td className={`${baseClass}__from`}>
						{diff.fromRowIds || diff.toRowIds
							? formatRowIds(diff.fromRowIds)
							: formatValue(diff.from)}
					</td>
					<td className={`${baseClass}__arrow`} aria-hidden="true">
						→
					</td>
					<td className={`${baseClass}__to`}>
						{diff.fromRowIds || diff.toRowIds ? formatRowIds(diff.toRowIds) : formatValue(diff.to)}
					</td>
				</tr>
			))}
		</tbody>
	</table>
)

export interface HistoryDebugOverlayProps {
	/**
	 * The live history object. Read during render rather than held in state: the
	 * owning component re-renders this overlay whenever it mutates.
	 */
	history: UndoHistory
	/** Live form state, used to show edits not yet captured into an entry. */
	fields: FormState | null
	/** Monotonic counter of captures and restores, shown as a liveness signal. */
	revision: number
	/** False under autosave, where the saved baseline is deliberately not tracked. */
	tracksSavedState: boolean
	onClose: () => void
	onJump: (index: number) => void
}

/**
 * Developer overlay listing every history entry with the paths it changed,
 * which entry is current, and any pending edits still inside the capture
 * debounce. Rendered only when the plugin runs with `debug: true`. Clicking an
 * entry restores it, which makes stepping through a suspect sequence far
 * cheaper than repeatedly pressing undo.
 */
export const HistoryDebugOverlay: React.FC<HistoryDebugOverlayProps> = ({
	history,
	fields,
	revision,
	tracksSavedState,
	onClose,
	onJump,
}) => {
	const { t } = useTranslation()
	/** Entry id, not index: the cap evicts from the front and shifts indexes. */
	const [expanded, setExpanded] = useState<number | null>(null)
	const [mounted, setMounted] = useState(false)

	// Portals need a DOM target, which does not exist during the server render.
	useEffect(() => setMounted(true), [])

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	if (!mounted) return null

	const pending = fields
		? diffComparable(history.stack[history.index]?.comparable ?? {}, extractComparable(fields))
		: []

	const copy = () => {
		const payload = history.stack.map((entry, index) => ({
			index,
			current: index === history.index,
			changed: diffComparable(history.stack[index - 1]?.comparable ?? {}, entry.comparable),
		}))
		void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
	}

	return createPortal(
		<div className={baseClass} role="dialog" aria-label={t(keys.debugTitle)}>
			<header className={`${baseClass}__header`}>
				<strong className={`${baseClass}__title`}>{t(keys.debugTitle)}</strong>
				<span className={`${baseClass}__meta`}>
					{history.stack.length === 0 ? 0 : history.index + 1}/{history.stack.length} ·{' '}
					{!tracksSavedState
						? 'autosave, no baseline'
						: history.savedComparable
							? isAtSavedState(history)
								? 'clean'
								: 'unsaved'
							: 'no baseline'}{' '}
					· rev {revision}
				</span>
				<button className={`${baseClass}__action`} onClick={copy} type="button">
					{t(keys.debugCopy)}
				</button>
				<button
					aria-label={t(keys.debugClose)}
					className={`${baseClass}__action`}
					onClick={onClose}
					type="button"
				>
					✕
				</button>
			</header>

			<div className={`${baseClass}__body`}>
				{history.stack.length === 0 ? (
					<p className={`${baseClass}__empty`}>{t(keys.debugEmpty)}</p>
				) : null}

				{history.stack.map((entry, index) => {
					const changed = diffComparable(
						history.stack[index - 1]?.comparable ?? {},
						entry.comparable
					)
					const isCurrent = index === history.index
					const isOpen = expanded === entry.id
					// Compared by value, so more than one entry can read as saved,
					// which is correct: they hold the same form state.
					const isSaved =
						history.savedComparable !== null && deepEqual(entry.comparable, history.savedComparable)
					return (
						<section
							className={`${baseClass}__entry${isCurrent ? ` ${baseClass}__entry--current` : ''}`}
							key={entry.id}
						>
							<div className={`${baseClass}__entryHead`}>
								<button
									aria-expanded={isOpen}
									className={`${baseClass}__toggle`}
									onClick={() => setExpanded(isOpen ? null : entry.id)}
									type="button"
								>
									<span className={`${baseClass}__caret`} aria-hidden="true">
										{isOpen ? '▾' : '▸'}
									</span>
									<span className={`${baseClass}__index`}>#{index}</span>
									{isSaved ? (
										<span className={`${baseClass}__saved`} title="matches the persisted document">
											saved
										</span>
									) : null}
									<span className={`${baseClass}__summary`}>
										{index === 0
											? t(keys.debugOriginal)
											: changed.map((diff) => diff.path).join(', ') || '(no visible change)'}
									</span>
									<span className={`${baseClass}__count`}>{changed.length}</span>
								</button>
								<button
									className={`${baseClass}__jump`}
									disabled={isCurrent}
									onClick={() => onJump(index)}
									type="button"
								>
									restore
								</button>
							</div>
							{isOpen && changed.length > 0 ? <DiffRows diffs={changed} /> : null}
						</section>
					)
				})}

				{pending.length > 0 ? (
					<section className={`${baseClass}__entry ${baseClass}__entry--pending`}>
						<div className={`${baseClass}__entryHead`}>
							<span className={`${baseClass}__summary`}>{t(keys.debugPending)}</span>
							<span className={`${baseClass}__count`}>{pending.length}</span>
						</div>
						<DiffRows diffs={pending} />
					</section>
				) : null}
			</div>
		</div>,
		document.body
	)
}
