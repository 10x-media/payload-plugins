'use client'

import {
	type PptxSlideThumbnailRenderWindow,
	type PptxViewerController,
	usePptxViewerThumbnails,
} from '@extend-ai/react-pptx'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

const THUMBNAIL_WIDTH = 112
/** Thumbnail plus its slide number and the gap below; a 16:9 slide lands near this. */
const ROW_ESTIMATE = 96
/** Rows rendered ahead of the visible ones, so a short scroll finds them painted. */
const PREFETCH_ROWS = 2

const EMPTY_WINDOW: PptxSlideThumbnailRenderWindow = {
	prefetchSlideIndexes: [],
	visibleSlideIndexes: [],
}

const sameIndexes = (a: readonly number[] = [], b: readonly number[] = []) =>
	a.length === b.length && a.every((value, index) => value === b[index])

export type PptxThumbnailsProps = {
	/** 0-based slide shown in the main view. */
	activeSlide: number
	controller: PptxViewerController
	onSelectSlide: (slideIndex: number) => void
}

/**
 * The slide rail beside a PPTX preview, after extend's own viewer: virtualized,
 * and only the rows on screen (plus a few ahead) render. Follows the main view,
 * keeping the active slide's thumbnail in sight.
 */
export const PptxThumbnails = ({ activeSlide, controller, onSelectSlide }: PptxThumbnailsProps) => {
	const { t } = useTranslation()
	const scrollRef = useRef<HTMLDivElement>(null)
	const [renderWindow, setRenderWindow] = useState(EMPTY_WINDOW)
	const options = useMemo(
		() => ({
			renderWindow,
			resolution: { maxHeight: Math.round(THUMBNAIL_WIDTH * 0.75), maxWidth: THUMBNAIL_WIDTH },
		}),
		[renderWindow]
	)
	const { thumbnails } = usePptxViewerThumbnails(controller, options)

	const virtualizer = useVirtualizer({
		count: thumbnails.length,
		estimateSize: () => ROW_ESTIMATE,
		getItemKey: (index) => thumbnails[index]?.slideIndex ?? index,
		getScrollElement: () => scrollRef.current,
		overscan: 3,
	})
	const rows = virtualizer.getVirtualItems()
	const first = rows[0]?.index ?? 0
	const last = rows.at(-1)?.index ?? first

	useEffect(() => {
		const visible: number[] = []
		const prefetch: number[] = []
		const from = Math.max(0, first - PREFETCH_ROWS)
		const to = Math.min(thumbnails.length - 1, last + PREFETCH_ROWS)
		for (let index = from; index <= to; index += 1) {
			const slideIndex = thumbnails[index]?.slideIndex
			if (slideIndex !== undefined) {
				;(index >= first && index <= last ? visible : prefetch).push(slideIndex)
			}
		}
		setRenderWindow((current) =>
			sameIndexes(current.visibleSlideIndexes, visible) &&
			sameIndexes(current.prefetchSlideIndexes, prefetch)
				? current
				: { prefetchSlideIndexes: prefetch, visibleSlideIndexes: visible }
		)
	}, [first, last, thumbnails])

	useEffect(() => {
		if (thumbnails.length > 0) {
			virtualizer.scrollToIndex(Math.min(activeSlide, thumbnails.length - 1), { align: 'auto' })
		}
	}, [activeSlide, thumbnails.length, virtualizer])

	return (
		<nav aria-label={t(keys.slides)} className="document-preview-rail" ref={scrollRef}>
			<div className="document-preview-rail__list" style={{ height: virtualizer.getTotalSize() }}>
				{rows.map((row) => {
					const thumbnail = thumbnails[row.index]
					if (!thumbnail) {
						return null
					}
					return (
						<button
							aria-current={thumbnail.slideIndex === activeSlide ? 'page' : undefined}
							className="document-preview-rail__item"
							data-index={row.index}
							key={row.key}
							onClick={() => onSelectSlide(thumbnail.slideIndex)}
							ref={virtualizer.measureElement}
							style={{ transform: `translateY(${row.start}px)` }}
							type="button"
						>
							<span
								className="document-preview-rail__page document-preview-rail__page--slide"
								ref={thumbnail.containerRef}
								style={{ aspectRatio: String(thumbnail.aspectRatio) }}
							/>
							<span className="document-preview-rail__number">{thumbnail.slideNumber}</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}
