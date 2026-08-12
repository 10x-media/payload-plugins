'use client'

import { useDrawerSlug, useModal } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import type { WikiGuideDoc, WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'

export type GuideLinkFields = {
	guide?: null | number | string | WikiGuideDoc
	label?: null | string
}

const entryFromGuide = (guide: WikiGuideDoc): WikiTargetEntry => ({
	featured: false,
	featuredOrder: null,
	id: guide.id,
	slug: guide.slug ?? null,
	summary: guide.summary ?? null,
	title: guide.title ?? null,
})

/**
 * A guide-to-guide link inside rendered content: opens the target guide in a
 * drawer stacked on top of the current one, so the reader never leaves the
 * page. A deleted or unreadable target degrades to dimmed plain text.
 */
export const GuideLink = ({ fields }: { fields: GuideLinkFields }) => {
	const { t } = useTranslation()
	const { loadGuide } = useWikiTargets()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-guide-link')
	const raw = fields.guide
	const populated = typeof raw === 'object' && raw !== null ? raw : null
	const guideId: null | number | string = populated
		? populated.id
		: typeof raw === 'object'
			? null
			: (raw ?? null)
	/**
	 * Only the lazily loaded guide is state; a populated one is read straight off
	 * the field. Keeping both in one state variable meant a field that changed
	 * from an id to a populated document (or to a different id) kept rendering the
	 * document fetched for the previous one, because the effect returns early as
	 * soon as a populated value is present.
	 */
	const [loaded, setLoaded] = useState<null | WikiGuideDoc>(null)

	useEffect(() => {
		setLoaded(null)
		if (populated || guideId === null) {
			return
		}
		let cancelled = false
		void loadGuide(guideId).then((next) => {
			if (!cancelled) {
				setLoaded(next)
			}
		})
		return () => {
			cancelled = true
		}
	}, [guideId, loadGuide, populated])

	const guide = populated ?? loaded

	const label = fields.label || guide?.title || null

	if (!guide) {
		return (
			<span className="wiki-guide-link wiki-guide-link--dead" title={t(keys.guideUnavailable)}>
				{label ?? t(keys.guideUnavailable)}
			</span>
		)
	}

	return (
		<>
			<button className="wiki-guide-link" onClick={() => openModal(drawerSlug)} type="button">
				{label}
			</button>
			<GuideDrawer entries={[entryFromGuide(guide)]} slug={drawerSlug} />
		</>
	)
}
