'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MIN_TOC_HEADINGS, tocHeadings, type WikiHeading } from '../../shared/headings'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './toc.css'

/**
 * How much of a heading has to be in the scroll area before it counts as read.
 * A band-shaped `rootMargin` was the previous approach and is what forced a
 * single active heading: it narrows the scroll area to a sliver, which only one
 * heading can occupy at a time. Observing the headings themselves lets every one
 * currently on screen report in, which is the whole point of the range below.
 */
const VISIBLE_THRESHOLD = 0.9

export type WikiTocProps = {
	headings: WikiHeading[]
}

const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((id, index) => id === b[index])

/**
 * In-page navigation for a guide, rendered to the right of the prose. It is the
 * only navigation on that side: the drawer's left rail switches between guides,
 * so a guide drawer that has a rail renders no TOC at all. Two lists that look
 * alike but one scrolls and the other navigates is a choice a reader cannot make
 * by looking, which is why the caller decides and this component never competes.
 *
 * Every heading on screen is active at once, drawn as one continuous track over
 * the list's rule rather than as separate marks per item: what the reader wants
 * to know is which stretch of the guide they are looking at, and three short
 * sections that fit together are one stretch. When no heading is on screen, the
 * reader is inside a long section, and the heading nearest the top of the scroll
 * area stands in for it.
 *
 * Renders nothing unless the guide has enough headings to be worth navigating.
 */
export const WikiToc = ({ headings }: WikiTocProps) => {
	const { t } = useTranslation()
	const navRef = useRef<HTMLElement | null>(null)
	const bodyRef = useRef<HTMLDivElement | null>(null)
	const itemsRef = useRef(new Map<string, HTMLLIElement>())
	const measureRef = useRef<() => void>(() => undefined)
	const [activeIds, setActiveIds] = useState<string[]>([])
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

	/**
	 * The track is two custom properties rather than a positioned element per
	 * item, so the browser tweens one box between ranges instead of cross-fading
	 * N marks. Offsets are read from the list items because they already carry the
	 * indentation and the wrapping, which is what makes the ends line up.
	 */
	const measureTrack = useCallback(() => {
		const body = bodyRef.current
		if (!body) {
			return
		}
		const first = activeIds[0] ? itemsRef.current.get(activeIds[0]) : undefined
		const last = activeIds.at(-1) ? itemsRef.current.get(activeIds.at(-1) as string) : undefined
		if (!first || !last) {
			return
		}
		body.style.setProperty('--wiki-toc-track-top', `${first.offsetTop}px`)
		body.style.setProperty(
			'--wiki-toc-track-height',
			`${last.offsetTop + last.offsetHeight - first.offsetTop}px`
		)
	}, [activeIds])

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

		/** The heading a reader is under when none is on screen. */
		const nearestToTop = (viewTop: number): string | undefined => {
			let closestId: string | undefined
			let closestDistance = Number.POSITIVE_INFINITY
			for (const heading of items) {
				const element = findHeading(heading.id)
				if (!element) {
					continue
				}
				const distance = Math.abs(viewTop - element.getBoundingClientRect().top)
				if (distance < closestDistance) {
					closestDistance = distance
					closestId = heading.id
				}
			}
			return closestId
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						visible.add(entry.target.id)
					} else {
						visible.delete(entry.target.id)
					}
				}
				// Rebuilt from `items` rather than from the set, so the range is always
				// in document order and its ends are its first and last heading.
				let next = items.filter((heading) => visible.has(heading.id)).map((heading) => heading.id)
				if (next.length === 0) {
					const fallback = nearestToTop(entries[0]?.rootBounds?.top ?? 0)
					next = fallback ? [fallback] : []
				}
				setActiveIds((previous) => (sameIds(previous, next) ? previous : next))
			},
			{ root, threshold: VISIBLE_THRESHOLD }
		)
		for (const element of elements) {
			observer.observe(element)
		}
		return () => observer.disconnect()
	}, [enabled, findHeading, items])

	useEffect(() => {
		measureRef.current = measureTrack
		measureTrack()
	}, [measureTrack])

	/**
	 * Wrapping changes every offset below it, so the track is re-measured on
	 * resize. The observer reads the measure function through a ref because the
	 * range it closes over changes on nearly every scroll tick, and rebuilding a
	 * ResizeObserver that often to learn the same box is pure churn.
	 */
	useEffect(() => {
		const body = bodyRef.current
		if (!body) {
			return
		}
		const observer = new ResizeObserver(() => measureRef.current())
		observer.observe(body)
		return () => observer.disconnect()
	}, [])

	if (!enabled) {
		return null
	}

	return (
		<nav aria-label={t(keys.tocHeading)} className="wiki-toc" ref={navRef}>
			<p className="wiki-toc__heading">{t(keys.tocHeading)}</p>
			<div className="wiki-toc__body" ref={bodyRef}>
				<span
					aria-hidden="true"
					className={`wiki-toc__track${activeIds.length > 0 ? ' wiki-toc__track--visible' : ''}`}
				/>
				<ul className="wiki-toc__list">
					{items.map((heading) => (
						<li
							className={`wiki-toc__item wiki-toc__item--h${heading.level}`}
							key={heading.id}
							ref={(element) => {
								if (element) {
									itemsRef.current.set(heading.id, element)
								} else {
									itemsRef.current.delete(heading.id)
								}
							}}
						>
							<a
								/**
								 * Only the first heading of the range carries `aria-current`:
								 * the attribute names the one current item, where `data-active`
								 * is free to mark the whole stretch the range covers.
								 */
								aria-current={activeIds[0] === heading.id ? 'true' : undefined}
								className="wiki-toc__link"
								data-active={activeIds.includes(heading.id) ? 'true' : undefined}
								href={`#${heading.id}`}
								onClick={(event) => {
									const target = findHeading(heading.id)
									if (!target) {
										return
									}
									event.preventDefault()
									target.scrollIntoView({ behavior: 'smooth', block: 'start' })
									setActiveIds([heading.id])
								}}
							>
								{heading.text}
							</a>
						</li>
					))}
				</ul>
			</div>
		</nav>
	)
}
