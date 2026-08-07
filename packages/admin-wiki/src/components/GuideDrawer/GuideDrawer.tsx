'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { Drawer, useConfig, useModal } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import type { WikiGuideDoc, WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideArticle } from '../GuideArticle/GuideArticle'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './guide-drawer.css'

export type GuideDrawerProps = {
	/** The guides available in this drawer, in presentation order. */
	entries: WikiTargetEntry[]
	/** The guide opened first; defaults to the first entry. */
	initialGuideId?: number | string
	/** Modal slug the drawer is registered under (from `useDrawerSlug`). */
	slug: string
}

type LoadState = 'error' | 'loading' | 'ready'

/**
 * The reading drawer for one surface's guides: a slim rail switches between
 * guides when several target the surface (hidden for a single guide), the pane
 * renders the shared `GuideArticle`, and users with update access get an edit
 * shortcut. Content loads lazily on open and caches per guide and locale.
 */
export const GuideDrawer = ({ entries, initialGuideId, slug }: GuideDrawerProps) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { modalState } = useModal()
	const { canUpdate, loadGuide, pagesSlug, wikiViewEnabled } = useWikiTargets()
	const isOpen = Boolean(modalState[slug]?.isOpen)
	const [activeId, setActiveId] = useState<number | string | undefined>(
		initialGuideId ?? entries[0]?.id
	)
	const [doc, setDoc] = useState<null | WikiGuideDoc>(null)
	const [state, setState] = useState<LoadState>('loading')

	useEffect(() => {
		if (initialGuideId !== undefined) {
			setActiveId(initialGuideId)
		}
	}, [initialGuideId])

	const resolvedActiveId = useMemo(() => {
		if (activeId !== undefined && entries.some((entry) => entry.id === activeId)) {
			return activeId
		}
		return entries[0]?.id
	}, [activeId, entries])

	useEffect(() => {
		if (!isOpen || resolvedActiveId === undefined) {
			return
		}
		let cancelled = false
		setState('loading')
		void loadGuide(resolvedActiveId).then((loaded) => {
			if (cancelled) {
				return
			}
			setDoc(loaded)
			setState(loaded ? 'ready' : 'error')
		})
		return () => {
			cancelled = true
		}
	}, [isOpen, loadGuide, resolvedActiveId])

	const activeEntry = entries.find((entry) => entry.id === resolvedActiveId)
	const content = doc?.content as SerializedEditorState | null | undefined

	return (
		<Drawer slug={slug} title={activeEntry?.title ?? ''}>
			<div className="wiki-guide-drawer">
				{entries.length > 1 ? (
					<nav aria-label={t(keys.drawerGuideList)} className="wiki-guide-drawer__rail">
						{entries.map((entry) => (
							<button
								aria-current={entry.id === resolvedActiveId || undefined}
								className="wiki-guide-drawer__rail-item"
								key={entry.id}
								onClick={() => setActiveId(entry.id)}
								type="button"
							>
								{entry.title}
							</button>
						))}
					</nav>
				) : null}
				<div className="wiki-guide-drawer__pane">
					{(wikiViewEnabled && activeEntry?.slug) ||
					(canUpdate && resolvedActiveId !== undefined) ? (
						<div className="wiki-guide-drawer__actions">
							{wikiViewEnabled && activeEntry?.slug ? (
								<a
									className="wiki-guide-drawer__edit"
									href={`${config.routes.admin}/wiki/${activeEntry.slug}`}
								>
									{t(keys.wikiOpenInWiki)}
								</a>
							) : null}
							{canUpdate && resolvedActiveId !== undefined ? (
								<a
									className="wiki-guide-drawer__edit"
									href={`${config.routes.admin}/collections/${pagesSlug}/${resolvedActiveId}`}
								>
									{t(keys.drawerEditGuide)}
								</a>
							) : null}
						</div>
					) : null}
					{state === 'loading' ? (
						<p className="wiki-guide-drawer__status">{t(keys.guideLoading)}</p>
					) : null}
					{state === 'error' ? (
						<p className="wiki-guide-drawer__status">{t(keys.guideUnavailable)}</p>
					) : null}
					{state === 'ready' && content ? <GuideArticle data={content} /> : null}
					{state === 'ready' && !content ? (
						<p className="wiki-guide-drawer__status">{t(keys.guideUnavailable)}</p>
					) : null}
				</div>
			</div>
		</Drawer>
	)
}
