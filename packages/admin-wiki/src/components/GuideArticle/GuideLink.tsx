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
	children?: ReactNode
	guide?: null | number | string
}

/**
 * A guide-to-guide link inside rendered content: opens the target guide in a
 * drawer stacked on top of the current one. The words are the node's children,
 * so a link whose target no longer resolves still reads as the sentence the
 * author wrote, dimmed and titled with why; that verdict waits for the lookup,
 * since a link that is merely still loading is not a dead one.
 */
export const GuideLink = ({ children, guide: guideId = null }: GuideLinkProps) => {
	const { t } = useTranslation()
	const { loadGuide } = useWikiTargets()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-guide-link')
	const [guide, setGuide] = useState<null | WikiGuideDoc>(null)
	const [loading, setLoading] = useState(guideId !== null)

	useEffect(() => {
		setGuide(null)
		if (guideId === null) {
			setLoading(false)
			return
		}
		setLoading(true)
		let cancelled = false
		void loadGuide(guideId).then((next) => {
			if (!cancelled) {
				setGuide(next)
				setLoading(false)
			}
		})
		return () => {
			cancelled = true
		}
	}, [guideId, loadGuide])

	if (!guide) {
		return (
			<span
				className={loading ? 'wiki-guide-link' : 'wiki-guide-link wiki-guide-link--dead'}
				title={loading ? undefined : t(keys.guideUnavailable)}
			>
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
