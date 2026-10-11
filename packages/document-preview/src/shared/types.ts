import type { ComponentType } from 'react'

import { resolveMimeType } from './mime'

/** The upload fields a preview needs, read off an upload document. */
export type PreviewFile = {
	filename: string
	/** Byte size as stored by Payload; absent on documents saved without one. */
	filesize?: number
	/** The mime the viewer was chosen by (stored mime, corrected by extension where unreliable). */
	mimeType: string
	/** The file's URL as Payload serves it (`doc.url`); storage adapters may make it absolute. */
	url: string
}

/** Props every viewer receives, built-in or host-supplied. */
export type DocumentPreviewViewerProps = {
	/** Slug of the upload collection the document belongs to, when known. */
	collection?: string
	/** The full upload document, for viewers that need more than the file (e.g. a video id). */
	doc: Record<string, unknown>
	filename: string
	filesize?: number
	mimeType: string
	url: string
}

export type DocumentPreviewViewer = ComponentType<DocumentPreviewViewerProps>

/** Read the preview fields off an upload document; `undefined` when it has no file yet. */
export const toPreviewFile = (
	doc: null | Record<string, unknown> | undefined
): PreviewFile | undefined => {
	if (!doc) {
		return undefined
	}
	const { filename, filesize, mimeType, url } = doc
	if (typeof url !== 'string' || !url || typeof filename !== 'string' || !filename) {
		return undefined
	}
	return {
		filename,
		filesize: typeof filesize === 'number' ? filesize : undefined,
		mimeType: resolveMimeType(typeof mimeType === 'string' ? mimeType : undefined, filename),
		url,
	}
}
