'use client'

import { useDrawerSlug, useModal } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fieldTargetKey, type WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { HelpIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { WikiWriteGuide } from './WikiWriteGuide'
import './field-help.css'

const HOVER_CLOSE_DELAY_MS = 150

/**
 * The one-line adoption path for custom fields that hardcode their own
 * description rendering: returns the guides targeting a field's schema path,
 * plus the two permissions an empty state needs. Prefer `canWrite` for
 * rendering a write affordance: it already accounts for the configured
 * `writeAffordances` mode, where `canCreate` is the raw permission alone.
 */
export const useWikiFieldHelp = (schemaPath: string) => {
	const { canCreate, canWrite, entriesFor } = useWikiTargets()
	const entries = entriesFor(fieldTargetKey(schemaPath))
	return { canCreate, canWrite, entries, hasGuides: entries.length > 0 }
}

export type WikiTargetHelpProps = {
	/** Show the "write this guide" affordance when no guide exists yet. */
	showWriteAffordance?: boolean
	/** Full target key the surface listens on, e.g. `field:posts.title`. */
	targetKey: string
}

/**
 * The generic help surface for any target key: renders nothing unless a guide
 * targets it (or the reader may write one). The trigger anchors a card showing
 * each guide's summary on hover, and opens the full guide drawer on click.
 */
export const WikiTargetHelp = ({ showWriteAffordance = true, targetKey }: WikiTargetHelpProps) => {
	const { t } = useTranslation()
	const { openModal } = useModal()
	const { entriesFor } = useWikiTargets()
	const entries = entriesFor(targetKey)
	const drawerSlug = useDrawerSlug('wiki-field-help')
	const [open, setOpen] = useState(false)
	const [initialGuideId, setInitialGuideId] = useState<number | string | undefined>(undefined)
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const cancelClose = useCallback(() => {
		if (closeTimer.current) {
			clearTimeout(closeTimer.current)
			closeTimer.current = undefined
		}
	}, [])

	const scheduleClose = useCallback(() => {
		cancelClose()
		closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
	}, [cancelClose])

	useEffect(() => cancelClose, [cancelClose])

	useEffect(() => {
		if (!open) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false)
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [open])

	if (entries.length === 0) {
		return showWriteAffordance ? <WikiWriteGuide targetKey={targetKey} /> : null
	}

	const openGuide = (entry: WikiTargetEntry) => {
		setInitialGuideId(entry.id)
		setOpen(false)
		openModal(drawerSlug)
	}

	const single = entries.length === 1 ? entries[0] : undefined

	return (
		<span className="wiki-field-help">
			<button
				aria-expanded={open}
				aria-label={
					single ? t(keys.fieldHelpAria) : t(keys.fieldHelpMultipleAria, { count: entries.length })
				}
				className="wiki-field-help__trigger"
				onBlur={scheduleClose}
				onClick={() => {
					const first = entries[0]
					if (first) {
						openGuide(first)
					}
				}}
				onFocus={() => setOpen(true)}
				onMouseEnter={() => {
					cancelClose()
					setOpen(true)
				}}
				onMouseLeave={scheduleClose}
				type="button"
			>
				<HelpIcon size="small" />
				<span className="wiki-field-help__trigger-label">
					{single ? single.title : t(keys.guideCount, { count: entries.length })}
				</span>
			</button>
			{open ? (
				<span
					className="wiki-field-help__card"
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
					role="tooltip"
				>
					<span className="wiki-field-help__caret" />
					{entries.map((entry) => (
						<span className="wiki-field-help__item" key={entry.id}>
							<span className="wiki-field-help__item-title">{entry.title}</span>
							{entry.summary ? (
								<span className="wiki-field-help__item-summary">{entry.summary}</span>
							) : null}
							{single ? null : (
								<button
									className="wiki-field-help__item-open"
									onClick={() => openGuide(entry)}
									type="button"
								>
									{t(keys.fieldHelpOpenGuide)}
								</button>
							)}
						</span>
					))}
					{single ? (
						<span className="wiki-field-help__hint">{t(keys.fieldHelpOpenHint)}</span>
					) : null}
				</span>
			) : null}
			<GuideDrawer entries={entries} initialGuideId={initialGuideId} slug={drawerSlug} />
		</span>
	)
}

export type WikiFieldHelpProps = {
	/** Index-free schema path of the field, e.g. `posts.hero.title`. */
	schemaPath: string
}

/** The field help surface: `WikiTargetHelp` keyed by a field schema path. */
export const WikiFieldHelp = ({ schemaPath }: WikiFieldHelpProps) => (
	<WikiTargetHelp targetKey={fieldTargetKey(schemaPath)} />
)
