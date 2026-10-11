'use client'

import { lazy } from 'react'

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

/**
 * Built-in viewers, the last layer of resolution. Each is its own chunk,
 * fetched the first time a file of its kind is opened. Images are listed by
 * exact mime because `image/*` would claim TIFF and HEIC, which browsers
 * cannot decode.
 */
export const defaultViewers: ViewerMap<DocumentPreviewViewer> = {
	'application/json': TextViewer,
	'application/javascript': TextViewer,
	'application/pdf': PdfViewer,
	'application/sql': TextViewer,
	'application/vnd.ms-excel': XlsxViewer,
	'application/vnd.ms-excel.sheet.macroEnabled.12': XlsxViewer,
	'application/vnd.ms-powerpoint': PptxViewer,
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': PptxViewer,
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': XlsxViewer,
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DocxViewer,
	'application/xml': TextViewer,
	'application/yaml': TextViewer,
	'audio/*': AudioViewer,
	'image/avif': ImageViewer,
	'image/bmp': ImageViewer,
	'image/gif': ImageViewer,
	'image/jpeg': ImageViewer,
	'image/png': ImageViewer,
	'image/svg+xml': ImageViewer,
	'image/vnd.microsoft.icon': ImageViewer,
	'image/webp': ImageViewer,
	'image/x-icon': ImageViewer,
	'text/*': TextViewer,
	'text/csv': CsvViewer,
	'text/markdown': MarkdownViewer,
	'text/tab-separated-values': CsvViewer,
	'video/*': VideoViewer,
}
