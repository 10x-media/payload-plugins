'use client'

import {
	DocxEditorViewer,
	type ParsedDocxDocument,
	parseDocxForViewer,
	useDocxEditor,
	useDocxPageLayout,
	type ViewerZoomLevel,
} from '@extend-ai/react-docx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { OFFICE_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { DocxThumbnails } from './DocxThumbnails'
import { InfoCard } from './InfoCard'
import { RailIcon } from './RailIcon'
import { useFileContent } from './useFileContent'
import { PreviewLoading, WithFileContent } from './ViewerStatus'

/** extend clamps zoom to the same range; the buttons stop where it would. */
const MIN_ZOOM = 25
const MAX_ZOOM = 400
const STEP = 1.25

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** Space left above a page jumped to, so its top edge is not flush with the viewport. */
const PAGE_JUMP_OFFSET = 16

/**
 * The pages plus a toolbar with a page rail toggle, the page position and zoom.
 * Zoom starts at `automatic` (fit the width, never past 100%), and ctrl+wheel
 * or a trackpad pinch zooms, which extend leaves to the host. Pages stay light
 * in a dark admin: extend's dark mode inverts the document and leaves body text
 * barely readable, and a page reads as paper either way.
 *
 * The page count comes from `onPageCountChange` and the current page from the
 * scroll position, as in extend's own viewer: the editor's pagination state can
 * stay at one page while the viewer lays out all of them.
 */
const DocxPages = ({ document }: { document: ParsedDocxDocument }) => {
	const { t } = useTranslation()
	const editor = useDocxEditor({ document, initialDocumentTheme: 'light' })
	const { layout } = useDocxPageLayout(editor)
	const [pageCount, setPageCount] = useState(1)
	const [activePage, setActivePage] = useState(1)
	const scrollRef = useRef<HTMLDivElement>(null)
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
	const [showPages, setShowPages] = useState(false)
	const [level, setLevel] = useState<ViewerZoomLevel>('automatic')
	const [resolved, setResolved] = useState(100)
	const resolvedRef = useRef(resolved)
	resolvedRef.current = resolved

	// React registers wheel listeners as passive, and ctrl+wheel must not zoom the whole page.
	useEffect(() => {
		const scroller = scrollRef.current
		if (!scroller) {
			return
		}
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) {
				return
			}
			event.preventDefault()
			setLevel(clampZoom(resolvedRef.current * Math.exp(-event.deltaY * 0.002)))
		}
		scroller.addEventListener('wheel', onWheel, { passive: false })
		return () => scroller.removeEventListener('wheel', onWheel)
	}, [])

	const setScrollRef = useCallback((element: HTMLDivElement | null) => {
		scrollRef.current = element
		setScroller(element)
	}, [])

	// The page whose middle is nearest the viewport's middle, recomputed once per frame while scrolling.
	useEffect(() => {
		if (!scroller) {
			return
		}
		let frameId = 0
		const update = () => {
			const viewport = scroller.getBoundingClientRect()
			const middle = viewport.top + viewport.height / 2
			let closest = { distance: Number.POSITIVE_INFINITY, page: 1 }
			for (const page of scroller.querySelectorAll<HTMLElement>(
				'[data-docx-page-wrapper="true"][data-index]'
			)) {
				const rect = page.getBoundingClientRect()
				const distance = Math.abs(rect.top + rect.height / 2 - middle)
				if (distance < closest.distance) {
					closest = { distance, page: Number(page.dataset.index) + 1 }
				}
			}
			setActivePage(closest.page)
		}
		const onScroll = () => {
			cancelAnimationFrame(frameId)
			frameId = requestAnimationFrame(update)
		}
		frameId = requestAnimationFrame(update)
		scroller.addEventListener('scroll', onScroll, { passive: true })
		return () => {
			cancelAnimationFrame(frameId)
			scroller.removeEventListener('scroll', onScroll)
		}
	}, [scroller])

	// The rail sizes its list from `totalPages`, so it gets the count the viewer reported.
	const railEditor = useMemo(
		() => ({ ...editor, totalPages: Math.max(editor.totalPages, pageCount) }),
		[editor, pageCount]
	)

	// Virtualize against this container explicitly, as extend's own viewer does, rather than a guessed ancestor.
	const pageVirtualization = useMemo(
		() => ({ enabled: true, overscan: 1, scrollElement: scroller }),
		[scroller]
	)

	/**
	 * Scroll the main view to a page. A mounted page is measured; an unmounted one
	 * (virtualized away) is estimated from the page height and gap at this zoom,
	 * which lands close enough for it to mount.
	 */
	const scrollToPage = useCallback(
		(pageNumber: number) => {
			const container = scrollRef.current
			if (!container) {
				return
			}
			const page = container.querySelector<HTMLElement>(
				`[data-docx-page-wrapper="true"][data-index="${pageNumber - 1}"]`
			)
			const top = page
				? page.getBoundingClientRect().top -
					container.getBoundingClientRect().top +
					container.scrollTop
				: (pageNumber - 1) *
					(layout.pageHeightPx + layout.viewportDefaults.pageGapPx) *
					(resolvedRef.current / 100)
			container.scrollTo({ top: Math.max(0, top - PAGE_JUMP_OFFSET) })
		},
		[layout.pageHeightPx, layout.viewportDefaults.pageGapPx]
	)

	return (
		<div className="document-preview-docx">
			<div className="document-preview-docx__body">
				{showPages ? (
					<DocxThumbnails activePage={activePage} editor={railEditor} onSelectPage={scrollToPage} />
				) : null}
				<div className="document-preview-docx__scroll" ref={setScrollRef}>
					<DocxEditorViewer
						className="document-preview-docx__viewer"
						editor={editor}
						mode="read-only"
						onPageCountChange={(count) => setPageCount(Math.max(1, Math.round(count || 1)))}
						onZoomChange={(state) => setResolved(state.resolvedZoom)}
						pageGapBackgroundColor="transparent"
						pageVirtualization={pageVirtualization}
						zoom={level}
					/>
				</div>
			</div>
			<div className="document-preview-toolbar document-preview-office__toolbar">
				<div className="document-preview-office__position">
					<button
						aria-label={t(keys.pages)}
						aria-pressed={showPages}
						className="document-preview-toolbar__button"
						onClick={() => setShowPages((open) => !open)}
						title={t(keys.pages)}
						type="button"
					>
						<RailIcon />
					</button>
					<span className="document-preview-toolbar__value">
						{t(keys.pageOf, { current: activePage, total: pageCount })}
					</span>
				</div>
				<div className="document-preview-office__zoom">
					<button
						aria-label={t(keys.zoomOut)}
						className="document-preview-toolbar__button"
						disabled={resolved <= MIN_ZOOM}
						onClick={() => setLevel(clampZoom(resolved / STEP))}
						title={t(keys.zoomOut)}
						type="button"
					>
						−
					</button>
					<button
						className="document-preview-toolbar__button document-preview-toolbar__value"
						onClick={() => setLevel(100)}
						title={t(keys.actualSize)}
						type="button"
					>
						{Math.round(resolved)}%
					</button>
					<button
						aria-label={t(keys.zoomIn)}
						className="document-preview-toolbar__button"
						disabled={resolved >= MAX_ZOOM}
						onClick={() => setLevel(clampZoom(resolved * STEP))}
						title={t(keys.zoomIn)}
						type="button"
					>
						+
					</button>
					<button
						aria-pressed={level === 'fit-width'}
						className="document-preview-toolbar__button document-preview-toolbar__button--text"
						onClick={() => setLevel('fit-width')}
						type="button"
					>
						{t(keys.fitWidth)}
					</button>
					<button
						aria-pressed={level === 'fit-page'}
						className="document-preview-toolbar__button document-preview-toolbar__button--text"
						onClick={() => setLevel('fit-page')}
						type="button"
					>
						{t(keys.fitPage)}
					</button>
				</div>
			</div>
		</div>
	)
}

/**
 * Parses outside the editor hook so a parse failure lands on the card rather
 * than in the editor's status string, and the document is parsed exactly once.
 */
const DocxDocument = ({
	buffer,
	file,
}: {
	buffer: ArrayBuffer
	file: DocumentPreviewViewerProps
}) => {
	const [state, setState] = useState<
		{ document: ParsedDocxDocument; status: 'ready' } | { status: 'error' } | { status: 'loading' }
	>({ status: 'loading' })

	useEffect(() => {
		let cancelled = false
		parseDocxForViewer(buffer)
			.then((document) => {
				if (!cancelled) {
					setState({ document, status: 'ready' })
				}
			})
			.catch((error: unknown) => {
				console.error(`[document-preview] could not parse ${file.url}`, error)
				if (!cancelled) {
					setState({ status: 'error' })
				}
			})
		return () => {
			cancelled = true
		}
	}, [buffer, file.url])

	if (state.status === 'loading') {
		return <PreviewLoading />
	}
	if (state.status === 'error') {
		return (
			<InfoCard
				filename={file.filename}
				filesize={file.filesize}
				mimeType={file.mimeType}
				reason="failed"
			/>
		)
	}
	return <DocxPages document={state.document} />
}

/**
 * DOCX through extend's full read-only editor view. The package's lighter
 * `ReactDocxViewer` uses a simplified layout that drops embedded fonts, list
 * markers inherited from styles, and hard page breaks.
 */
export const DocxViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'arrayBuffer',
		maxBytes: OFFICE_MAX_BYTES,
		url: props.url,
	})
	return (
		<WithFileContent file={props} state={state}>
			{(buffer) => <DocxDocument buffer={buffer} file={props} />}
		</WithFileContent>
	)
}
