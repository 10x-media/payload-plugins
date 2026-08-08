'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MIN_TOC_HEADINGS, tocHeadings, type WikiHeading } from '../../shared/headings'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './toc.css'

/** Band at the top of the scroll area that decides which heading reads as current. */
const SPY_ROOT_MARGIN = '0px 0px -75% 0px'

export type WikiTocProps = {
	headings: WikiHeading[]
}

/**
 * In-page navigation for a guide, rendered to the right of the prose. It is the
 * only navigation on that side: the drawer's left rail switches between guides,
 * so a guide drawer that has a rail renders no TOC at all. Two lists that look
 * alike but one scrolls and the other navigates is a choice a reader cannot make
 * by looking, which is why the caller decides and this component never competes.
 *
 * Renders nothing unless the guide has enough headings to be worth navigating.
 */
export const WikiToc = ({ headings }: WikiTocProps) => {
	const { t } = useTranslation()
	const navRef = useRef<HTMLElement | null>(null)
	const [active, setActive] = useState<string | undefined>(undefined)
	const items = useMemo(() => tocHeadings(headings), [headings])
	const enabled = items.length >= MIN_TOC_HEADINGS

	/**
	 * Ids are unique within a guide, not within the page: two stacked guide
	 * drawers can hold the same heading text. Every lookup is therefore scoped to
	 * the layout element this TOC sits in, which is also the one holding its
	 * article.
	 */
	const findHeading = useCallback((id: string): HTMLElement | null => {
		const scope = navRef.current?.parentElement
		return scope?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ?? null
	}, [])

	useEffect(() => {
		if (!enabled) {
			return
		}
		const elements = items
			.map((heading) => findHeading(heading.id))
			.filter((element): element is HTMLElement => Boolean(element))
		if (elements.length === 0) {
			return
		}
		/**
		 * The drawer scrolls inside its own content element while the wiki view
		 * scrolls the window. `closest` finds the former and returns null for the
		 * latter, which is exactly the root the observer wants in each case.
		 */
		const root = navRef.current?.closest('.drawer__content-children') ?? null
		const visible = new Set<string>()
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						visible.add(entry.target.id)
					} else {
						visible.delete(entry.target.id)
					}
				}
				const first = items.find((heading) => visible.has(heading.id))
				if (first) {
					setActive(first.id)
				}
			},
			{ root, rootMargin: SPY_ROOT_MARGIN, threshold: 0 }
		)
		for (const element of elements) {
			observer.observe(element)
		}
		return () => observer.disconnect()
	}, [enabled, findHeading, items])

	if (!enabled) {
		return null
	}

	return (
		<nav aria-label={t(keys.tocHeading)} className="wiki-toc" ref={navRef}>
			<p className="wiki-toc__heading">{t(keys.tocHeading)}</p>
			<ul className="wiki-toc__list">
				{items.map((heading) => (
					<li className={`wiki-toc__item wiki-toc__item--h${heading.level}`} key={heading.id}>
						<a
							aria-current={active === heading.id ? 'true' : undefined}
							className="wiki-toc__link"
							href={`#${heading.id}`}
							onClick={(event) => {
								const target = findHeading(heading.id)
								if (!target) {
									return
								}
								event.preventDefault()
								target.scrollIntoView({ behavior: 'smooth', block: 'start' })
								setActive(heading.id)
							}}
						>
							{heading.text}
						</a>
					</li>
				))}
			</ul>
		</nav>
	)
}
