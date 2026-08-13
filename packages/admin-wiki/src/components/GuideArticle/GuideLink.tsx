'use client'

import { useDrawerSlug, useModal } from '@payloadcms/ui'
import { type ReactNode, useEffect, useState } from 'react'

import type { WikiGuideDoc, WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'

const entryFromGuide = (guide: WikiGuideDoc): WikiTargetEntry => ({
	featured: false,
	featuredOrder: null,
	id: guide.id,
	slug: guide.slug ?? null,
	summary: guide.summary ?? null,
	title: guide.title ?? null,
})

export type GuideLinkProps = {
	/** The link text, which is the node's own children rather than a stored label. */
	children?: ReactNode
	/** The target guide's id, as the node stores it. */
	guide?: null | number | string
}

/**
 * A guide-to-guide link inside rendered content: opens the target guide in a
 * drawer stacked on top of the current one, so the reader never leaves the page.
 *
 * The words are the node's children, so a link whose target was deleted still
 * reads as the sentence the author wrote; only the affordance goes away, leaving
 * the text dimmed and titled with why.
 */
export const GuideLink = ({ children, guide: guideId = null }: GuideLinkProps) => {
	const { t } = useTranslation()
	const { loadGuide } = useWikiTargets()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-guide-link')
	const [guide, setGuide] = useState<null | WikiGuideDoc>(null)

	useEffect(() => {
		setGuide(null)
		if (guideId === null) {
			return
		}
		let cancelled = false
		void loadGuide(guideId).then((next) => {
			if (!cancelled) {
				setGuide(next)
			}
		})
		return () => {
			cancelled = true
		}
	}, [guideId, loadGuide])

	if (!guide) {
		return (
			<span className="wiki-guide-link wiki-guide-link--dead" title={t(keys.guideUnavailable)}>
				{children}
			</span>
		)
	}

	return (
		<>
			<button className="wiki-guide-link" onClick={() => openModal(drawerSlug)} type="button">
				{children}
			</button>
			<GuideDrawer entries={[entryFromGuide(guide)]} slug={drawerSlug} />
		</>
	)
}
