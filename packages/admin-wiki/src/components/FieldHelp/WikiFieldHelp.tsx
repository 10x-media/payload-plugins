'use client'

import { useConfig, useDrawerSlug, useModal } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fieldTargetKey, type WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './field-help.css'

const HOVER_CLOSE_DELAY_MS = 150

/**
 * The one-line adoption path for custom fields that hardcode their own
 * description rendering: returns the guides targeting a field's schema path
 * and the reader's create permission for the empty state.
 */
export const useWikiFieldHelp = (schemaPath: string) => {
	const { canCreate, entriesFor } = useWikiTargets()
	const entries = entriesFor(fieldTargetKey(schemaPath))
	return { canCreate, entries, hasGuides: entries.length > 0 }
}

const HelpIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		height="14"
		viewBox="0 0 16 16"
		width="14"
		xmlns="http://www.w3.org/2000/svg"
	>
		<circle cx="8" cy="8" r="6.5" stroke="currentColor" />
		<path
			d="M6.2 6.2a1.8 1.8 0 1 1 2.6 1.6c-.5.27-.8.6-.8 1.2v.3"
			stroke="currentColor"
			strokeLinecap="round"
		/>
		<circle cx="8" cy="11.4" fill="currentColor" r="0.7" stroke="none" />
	</svg>
)

export type WikiTargetHelpProps = {
	/** Show the "write this guide" affordance when no guide exists yet. */
	showWriteAffordance?: boolean
	/** Full target key the surface listens on, e.g. `field:posts.title`. */
	targetKey: string
}

/**
 * The generic help surface for any target key: renders nothing unless a guide
 * targets it (or the reader may write one). A subtle trigger anchors a hover
 * card showing each guide's summary, escalating to the full guide drawer.
 */
export const WikiTargetHelp = ({ showWriteAffordance = true, targetKey }: WikiTargetHelpProps) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { openModal } = useModal()
	const { canCreate, entriesFor, pagesSlug } = useWikiTargets()
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
		if (!canCreate || !showWriteAffordance) {
			return null
		}
		return (
			<a
				className="wiki-field-help__write"
				href={`${config.routes.admin}/collections/${pagesSlug}/create`}
			>
				+ {t(keys.fieldHelpWriteGuide)}
			</a>
		)
	}

	const openGuide = (entry: WikiTargetEntry) => {
		setInitialGuideId(entry.id)
		setOpen(false)
		openModal(drawerSlug)
	}

	return (
		<span className="wiki-field-help">
			<button
				aria-expanded={open}
				aria-label={t(keys.fieldHelpAria)}
				className="wiki-field-help__trigger"
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
				<HelpIcon />
				<span className="wiki-field-help__trigger-label">
					{entries.length === 1 ? entries[0]?.title : `${entries.length}`}
				</span>
			</button>
			{open ? (
				<span
					className="wiki-field-help__card"
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
					role="tooltip"
				>
					{entries.map((entry) => (
						<span className="wiki-field-help__card-item" key={entry.id}>
							<span className="wiki-field-help__card-title">{entry.title}</span>
							{entry.summary ? (
								<span className="wiki-field-help__card-summary">{entry.summary}</span>
							) : null}
							<button
								className="wiki-field-help__card-open"
								onClick={() => openGuide(entry)}
								type="button"
							>
								{t(keys.fieldHelpOpenGuide)}
							</button>
						</span>
					))}
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
