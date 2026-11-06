'use client'

import { lazy } from 'react'

import { BUILT_IN_VIEWERS, type ViewerKind } from '../shared/builtInViewers'
import type { ViewerMap } from '../shared/resolveViewer'
import type { DocumentPreviewViewer } from '../shared/types'

const ImageViewer = lazy(() => import('./ImageViewer').then((m) => ({ default: m.ImageViewer })))
const VideoViewer = lazy(() => import('./VideoViewer').then((m) => ({ default: m.VideoViewer })))
const AudioViewer = lazy(() => import('./AudioViewer').then((m) => ({ default: m.AudioViewer })))
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })))
const TextViewer = lazy(() => import('./TextViewer').then((m) => ({ default: m.TextViewer })))
const MarkdownViewer = lazy(() =>
	import('./MarkdownViewer').then((m) => ({ default: m.MarkdownViewer }))
)
const CsvViewer = lazy(() => import('./CsvViewer').then((m) => ({ default: m.CsvViewer })))
const DocxViewer = lazy(() => import('./DocxViewer').then((m) => ({ default: m.DocxViewer })))
const XlsxViewer = lazy(() => import('./XlsxViewer').then((m) => ({ default: m.XlsxViewer })))
const PptxViewer = lazy(() => import('./PptxViewer').then((m) => ({ default: m.PptxViewer })))

const VIEWERS: Record<ViewerKind, DocumentPreviewViewer> = {
	audio: AudioViewer,
	csv: CsvViewer,
	docx: DocxViewer,
	image: ImageViewer,
	markdown: MarkdownViewer,
	pdf: PdfViewer,
	pptx: PptxViewer,
	text: TextViewer,
	video: VideoViewer,
	xlsx: XlsxViewer,
}

/**
 * Built-in viewers, the last layer of resolution. Each is its own chunk,
 * fetched the first time a file of its kind is opened.
 */
export const defaultViewers: ViewerMap<DocumentPreviewViewer> = Object.fromEntries(
	Object.entries(BUILT_IN_VIEWERS).map(([pattern, kind]) => [pattern, VIEWERS[kind]])
)
