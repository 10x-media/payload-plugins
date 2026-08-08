'use client'

import { Button, PopupList, useDrawerSlug, useModal } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { WikiWriteGuide } from '../FieldHelp/WikiWriteGuide'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { BookIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './surface-trigger.css'

export type WikiSurfaceTriggerProps = {
	/** The surface's target key, e.g. `collection:posts` or `global:settings`. */
	targetKey: string
	/** `menuItem` renders as a row inside the ⋯ menu; `button` everywhere else. */
	variant?: 'button' | 'menuItem'
}

/**
 * The guide trigger for collection list views, document edit views, and
 * globals. Opens the surface's guides in the reading drawer; renders the
 * "write this guide" affordance for users who may author when the surface has
 * no guide, and nothing at all for everyone else.
 *
 * The button is Payload's own `Button` in its `pill` style: on a list view it
 * sits beside the locale selector, and on an edit view beside Save, reading as
 * a peer of both without competing with either.
 */
export const WikiSurfaceTrigger = ({ targetKey, variant = 'button' }: WikiSurfaceTriggerProps) => {
	const { entriesFor } = useWikiTargets()
	const { openModal } = useModal()
	const { t } = useTranslation()
	const drawerSlug = useDrawerSlug('wiki-surface')
	const entries = entriesFor(targetKey)

	if (entries.length === 0) {
		if (variant === 'menuItem') {
			return <WikiWriteGuide targetKey={targetKey} variant="menuItem" />
		}
		return <WikiWriteGuide targetKey={targetKey} variant="button" />
	}

	const single = entries.length === 1 ? entries[0] : undefined
	const label = single
		? (single.title ?? t(keys.surfaceTriggerLabel))
		: t(keys.guideCount, { count: entries.length })

	return (
		<>
			{variant === 'menuItem' ? (
				<PopupList.Button onClick={() => openModal(drawerSlug)}>{label}</PopupList.Button>
			) : (
				<Button
					buttonStyle="pill"
					className="wiki-surface-trigger"
					icon={<BookIcon size="small" />}
					iconPosition="left"
					iconStyle="none"
					margin={false}
					onClick={() => openModal(drawerSlug)}
					size="small"
					tooltip={single ? undefined : t(keys.surfaceTriggerLabel)}
				>
					{label}
				</Button>
			)}
			<GuideDrawer entries={entries} slug={drawerSlug} />
		</>
	)
}
