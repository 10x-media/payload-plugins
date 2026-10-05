'use client'

import {
	type DocxEditorController,
	type DocxPageThumbnailRenderWindow,
	useDocxViewerThumbnails,
} from '@extend-ai/react-docx'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

const THUMBNAIL_WIDTH = 92
/** Thumbnail plus its page number and the gap below; a portrait page lands near this. */
const ROW_ESTIMATE = 172
/** Rows rendered ahead of the visible ones, so a short scroll finds them painted. */
const PREFETCH_ROWS = 4

const EMPTY_WINDOW: DocxPageThumbnailRenderWindow = {
	prefetchPageIndexes: [],
	visiblePageIndexes: [],
}

const sameIndexes = (a: readonly number[] = [], b: readonly number[] = []) =>
	a.length === b.length && a.every((value, index) => value === b[index])

export type DocxThumbnailsProps = {
	/** 1-based page shown in the main view. */
	activePage: number
	editor: DocxEditorController
	onSelectPage: (pageNumber: number) => void
}

/**
 * The page rail beside a DOCX preview, after extend's own viewer: virtualized,
 * and only the rows on screen (plus a few ahead) are rasterized. Follows the
 * main view, keeping the active page's thumbnail in sight.
 */
export const DocxThumbnails = ({ activePage, editor, onSelectPage }: DocxThumbnailsProps) => {
	const { t } = useTranslation()
	const scrollRef = useRef<HTMLDivElement>(null)
	const [renderWindow, setRenderWindow] = useState(EMPTY_WINDOW)
	const options = useMemo(
		() => ({
			pixelRatio: 2,
			renderWindow,
			resolution: { maxHeight: THUMBNAIL_WIDTH * 1.35, maxWidth: THUMBNAIL_WIDTH },
		}),
		[renderWindow]
	)
	const { thumbnails } = useDocxViewerThumbnails(editor, options)

	const virtualizer = useVirtualizer({
		count: thumbnails.length,
		estimateSize: () => ROW_ESTIMATE,
		getItemKey: (index) => thumbnails[index]?.pageIndex ?? index,
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
			const pageIndex = thumbnails[index]?.pageIndex
			if (pageIndex !== undefined) {
				;(index >= first && index <= last ? visible : prefetch).push(pageIndex)
			}
		}
		setRenderWindow((current) =>
			sameIndexes(current.visiblePageIndexes, visible) &&
			sameIndexes(current.prefetchPageIndexes, prefetch)
				? current
				: { prefetchPageIndexes: prefetch, visiblePageIndexes: visible }
		)
	}, [first, last, thumbnails])

	useEffect(() => {
		if (activePage >= 1 && thumbnails.length > 0) {
			virtualizer.scrollToIndex(Math.min(activePage - 1, thumbnails.length - 1), {
				align: 'auto',
			})
		}
	}, [activePage, thumbnails.length, virtualizer])

	return (
		<nav aria-label={t(keys.pages)} className="document-preview-rail" ref={scrollRef}>
			<div className="document-preview-rail__list" style={{ height: virtualizer.getTotalSize() }}>
				{rows.map((row) => {
					const thumbnail = thumbnails[row.index]
					if (!thumbnail) {
						return null
					}
					const isActive = thumbnail.pageNumber === activePage
					return (
						<button
							aria-current={isActive ? 'page' : undefined}
							className="document-preview-rail__item"
							data-index={row.index}
							key={row.key}
							onClick={() => onSelectPage(thumbnail.pageNumber)}
							ref={virtualizer.measureElement}
							style={{ transform: `translateY(${row.start}px)` }}
							type="button"
						>
							<canvas
								className="document-preview-rail__page"
								height={thumbnail.pixelHeightPx}
								ref={thumbnail.canvasRef}
								style={{ aspectRatio: String(thumbnail.aspectRatio) }}
								width={thumbnail.pixelWidthPx}
							/>
							<span className="document-preview-rail__number">{thumbnail.pageNumber}</span>
						</button>
					)
				})}
			</div>
		</nav>
	)
}
