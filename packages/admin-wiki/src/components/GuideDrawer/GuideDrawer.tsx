'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { Button, Drawer, ShimmerEffect, useConfig, useModal } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import { collectGuideHeadings, hasTocHeadings } from '../../shared/headings'
import type { WikiGuideDoc, WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { GuideArticle } from '../GuideArticle/GuideArticle'
import { BookIcon, StarIcon } from '../icons'
import { WikiToc } from '../Toc/WikiToc'
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
 * The reading drawer for one surface's guides: a rail switches between guides
 * when several target the surface (hidden for a single guide), the pane leads
 * with the guide's title and summary and renders the shared `GuideArticle`, and
 * users with update access get an edit shortcut. Content loads lazily on open
 * and caches per guide and locale.
 *
 * Payload 4 drops the document header inside drawers and titles the drawer in
 * its small header bar, which suits a form. A guide is read, so the pane carries
 * the title as its h1, as the wiki page does, and the bar says what the drawer
 * is ("Wiki") rather than repeating it. The bar does not name the guide a nested
 * drawer returns to: Payload's never does either, and drawers nest without end.
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
	const hasRail = entries.length > 1
	/**
	 * The rail owns the left side when it exists, and a table of contents on the
	 * right would then be a second navigation list in the same drawer. One
	 * navigation surface per drawer: with several guides the reader switches
	 * guides, with one guide they move within it.
	 */
	const { headings } = useMemo(() => collectGuideHeadings(content), [content])
	const showToc = !hasRail && hasTocHeadings(headings)
	const wikiHref =
		wikiViewEnabled && activeEntry?.slug
			? `${config.routes.admin}/wiki/${encodeURIComponent(activeEntry.slug)}`
			: undefined
	const editHref =
		canUpdate && resolvedActiveId !== undefined
			? `${config.routes.admin}/collections/${pagesSlug}/${resolvedActiveId}`
			: undefined

	return (
		<Drawer className="wiki-guide-drawer-modal" slug={slug} title={t(keys.wikiViewTitle)}>
			<div className="wiki-guide-drawer">
				{hasRail ? (
					<nav aria-label={t(keys.drawerGuideList)} className="wiki-guide-drawer__rail">
						<p className="wiki-guide-drawer__rail-heading">
							{t(keys.guideCount, { count: entries.length })}
						</p>
						{entries.map((entry) => (
							<button
								aria-current={entry.id === resolvedActiveId || undefined}
								className="wiki-guide-drawer__rail-item"
								key={entry.id}
								onClick={() => setActiveId(entry.id)}
								type="button"
							>
								{entry.featured ? <StarIcon size="small" /> : <BookIcon size="small" />}
								<span className="wiki-guide-drawer__rail-label">{entry.title}</span>
							</button>
						))}
					</nav>
				) : null}
				<div className="wiki-guide-drawer__pane">
					<header className="wiki-guide-drawer__header">
						<div className="wiki-guide-drawer__heading">
							<h1 className="wiki-guide-drawer__title">
								{activeEntry?.title}
								{activeEntry?.featured ? <StarIcon /> : null}
							</h1>
							{activeEntry?.summary ? (
								<p className="wiki-guide-drawer__summary">{activeEntry.summary}</p>
							) : null}
						</div>
						{wikiHref || editHref ? (
							<div className="wiki-guide-drawer__actions">
								{wikiHref ? (
									<Button buttonStyle="pill" el="link" margin={false} size="medium" to={wikiHref}>
										{t(keys.wikiOpenInWiki)}
									</Button>
								) : null}
								{editHref ? (
									<Button
										buttonStyle="pill"
										el="link"
										icon="edit"
										iconPosition="left"
										margin={false}
										size="medium"
										to={editHref}
									>
										{t(keys.drawerEditGuide)}
									</Button>
								) : null}
							</div>
						) : null}
					</header>
					{state === 'loading' ? (
						<div className="wiki-guide-drawer__loading">
							<ShimmerEffect height="1rem" width="70%" />
							<ShimmerEffect height="1rem" width="90%" />
							<ShimmerEffect height="1rem" width="80%" />
						</div>
					) : null}
					{state === 'error' || (state === 'ready' && !content) ? (
						<p className="wiki-guide-drawer__status">{t(keys.guideUnavailable)}</p>
					) : null}
					{state === 'ready' && content ? <GuideArticle data={content} /> : null}
				</div>
				{showToc ? <WikiToc headings={headings} /> : null}
			</div>
		</Drawer>
	)
}
