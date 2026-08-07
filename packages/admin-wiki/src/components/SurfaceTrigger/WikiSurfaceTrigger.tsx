'use client'

import { PopupList, useConfig, useDrawerSlug, useModal } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './surface-trigger.css'

const BookIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		height="16"
		viewBox="0 0 16 16"
		width="16"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			d="M8 3.2C6.9 2.4 5.4 2 3.5 2c-.4 0-.8 0-1.2.1v9.7c.4-.05.8-.08 1.2-.08 1.9 0 3.4.4 4.5 1.18 1.1-.78 2.6-1.18 4.5-1.18.4 0 .8.03 1.2.08V2.1A9.6 9.6 0 0 0 12.5 2C10.6 2 9.1 2.4 8 3.2Z"
			stroke="currentColor"
			strokeLinejoin="round"
		/>
		<path d="M8 3.4v9.3" stroke="currentColor" />
	</svg>
)

export type WikiSurfaceTriggerProps = {
	/** The surface's target key, e.g. `collection:posts` or `global:settings`. */
	targetKey: string
	/** `menuItem` renders as a row inside the ⋯ menu; `button` everywhere else. */
	variant?: 'button' | 'menuItem'
}

/**
 * The guide trigger for collection list views, document edit views, and
 * globals. Opens the surface's guides in the reading drawer; renders the
 * "write this guide" affordance for users with create access when the surface
 * has no guide, and nothing at all for everyone else.
 */
export const WikiSurfaceTrigger = ({ targetKey, variant = 'button' }: WikiSurfaceTriggerProps) => {
	const { canCreate, entriesFor, pagesSlug } = useWikiTargets()
	const { config } = useConfig()
	const { openModal } = useModal()
	const { t } = useTranslation()
	const drawerSlug = useDrawerSlug('wiki-surface')
	const entries = entriesFor(targetKey)

	if (entries.length === 0) {
		if (!canCreate) {
			return null
		}
		const createHref = `${config.routes.admin}/collections/${pagesSlug}/create`
		if (variant === 'menuItem') {
			return <PopupList.Button href={createHref}>{t(keys.fieldHelpWriteGuide)}</PopupList.Button>
		}
		return (
			<a className="wiki-surface-trigger wiki-surface-trigger--write" href={createHref}>
				<BookIcon />
				<span>{t(keys.fieldHelpWriteGuide)}</span>
			</a>
		)
	}

	const label =
		entries.length === 1
			? (entries[0]?.title ?? t(keys.surfaceTriggerLabel))
			: `${t(keys.surfaceTriggerLabel)} (${entries.length})`

	return (
		<>
			{variant === 'menuItem' ? (
				<PopupList.Button onClick={() => openModal(drawerSlug)}>{label}</PopupList.Button>
			) : (
				<button
					className="wiki-surface-trigger"
					onClick={() => openModal(drawerSlug)}
					type="button"
				>
					<BookIcon />
					<span>{label}</span>
				</button>
			)}
			<GuideDrawer entries={entries} slug={drawerSlug} />
		</>
	)
}
