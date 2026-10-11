'use client'

import '@extend-ai/react-pptx/styles.css'

import {
	type PptxViewerController,
	ReactPptxViewer,
	type ViewerZoomLevel,
} from '@extend-ai/react-pptx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { OFFICE_MAX_BYTES } from '../shared/limits'
import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { InfoCard } from './InfoCard'
import { PptxThumbnails } from './PptxThumbnails'
import { RailIcon } from './RailIcon'
import { useFileContent } from './useFileContent'
import { PreviewLoading, WithFileContent } from './ViewerStatus'

const MIN_ZOOM = 25
const MAX_ZOOM = 400
const STEP = 1.25

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/**
 * Every slide in one scrolling column, with a toolbar for the slide rail, the
 * slide position and zoom. Scrolling belongs to this component's container,
 * handed to extend's virtualization as its scroll element, as extend's own
 * viewer does; ctrl+wheel or a trackpad pinch zooms.
 */
const Presentation = ({
	buffer,
	file,
}: {
	buffer: ArrayBuffer
	file: DocumentPreviewViewerProps
}) => {
	const { t } = useTranslation()
	const scrollRef = useRef<HTMLDivElement>(null)
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
	const [controller, setController] = useState<null | PptxViewerController>(null)
	const [slideCount, setSlideCount] = useState(0)
	const [activeSlide, setActiveSlide] = useState(0)
	const [showSlides, setShowSlides] = useState(false)
	const [level, setLevel] = useState<ViewerZoomLevel>('fit-width')
	const [resolved, setResolved] = useState(100)
	const resolvedRef = useRef(resolved)
	resolvedRef.current = resolved

	const setScrollRef = useCallback((element: HTMLDivElement | null) => {
		scrollRef.current = element
		setScroller(element)
	}, [])

	// React registers wheel listeners as passive, and ctrl+wheel must not zoom the whole page.
	useEffect(() => {
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
	}, [scroller])

	const virtualization = useMemo(
		() => ({ enabled: true, overscanViewport: 0.75, scrollElement: scroller }),
		[scroller]
	)

	const goToSlide = useCallback(
		(index: number) => {
			const target = Math.min(Math.max(0, index), Math.max(0, slideCount - 1))
			setActiveSlide(target)
			void controller?.goToSlide(target, { behavior: 'instant', block: 'center' })
		},
		[controller, slideCount]
	)

	return (
		<div className="document-preview-pptx">
			<div className="document-preview-pptx__body">
				{showSlides && controller ? (
					<PptxThumbnails
						activeSlide={activeSlide}
						controller={controller}
						onSelectSlide={goToSlide}
					/>
				) : null}
				<div className="document-preview-pptx__scroll" ref={setScrollRef}>
					<ReactPptxViewer
						className="document-preview-pptx__viewer"
						height="100%"
						mode="continuous"
						onError={(error) =>
							console.error(`[document-preview] could not parse ${file.url}`, error)
						}
						onLoad={(presentation) => setSlideCount(presentation.document.slides.length)}
						onSlideChange={setActiveSlide}
						onZoomChange={(state) => setResolved(state.resolvedZoom)}
						ref={setController}
						renderError={() => (
							<InfoCard
								filename={file.filename}
								filesize={file.filesize}
								mimeType={file.mimeType}
								reason="failed"
							/>
						)}
						renderLoading={() => <PreviewLoading />}
						showThumbnails={false}
						showToolbar={false}
						source={buffer}
						viewportClassName="document-preview-pptx__viewport"
						virtualization={virtualization}
						zoom={level}
					/>
				</div>
			</div>
			<div className="document-preview-toolbar document-preview-office__toolbar">
				<div className="document-preview-office__position">
					<button
						aria-label={t(keys.slides)}
						aria-pressed={showSlides}
						className="document-preview-toolbar__button"
						onClick={() => setShowSlides((open) => !open)}
						title={t(keys.slides)}
						type="button"
					>
						<RailIcon />
					</button>
					<button
						aria-label={t(keys.previousSlide)}
						className="document-preview-toolbar__button"
						disabled={activeSlide <= 0}
						onClick={() => goToSlide(activeSlide - 1)}
						title={t(keys.previousSlide)}
						type="button"
					>
						‹
					</button>
					<span className="document-preview-toolbar__value">
						{slideCount > 0
							? t(keys.slideOf, { current: activeSlide + 1, total: slideCount })
							: null}
					</span>
					<button
						aria-label={t(keys.nextSlide)}
						className="document-preview-toolbar__button"
						disabled={activeSlide >= slideCount - 1}
						onClick={() => goToSlide(activeSlide + 1)}
						title={t(keys.nextSlide)}
						type="button"
					>
						›
					</button>
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
						{t(keys.fitSlide)}
					</button>
				</div>
			</div>
		</div>
	)
}

/** PPTX and legacy PPT through extend's virtualized slide renderer. */
export const PptxViewer = (props: DocumentPreviewViewerProps) => {
	const state = useFileContent({
		filesize: props.filesize,
		kind: 'arrayBuffer',
		maxBytes: OFFICE_MAX_BYTES,
		url: props.url,
	})
	return (
		<WithFileContent file={props} state={state}>
			{(buffer) => <Presentation buffer={buffer} file={props} />}
		</WithFileContent>
	)
}
