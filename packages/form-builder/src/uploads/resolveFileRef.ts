import type { FileFieldConfig, FileRef, FileRefError } from './types'

type UploadDoc = {
	id?: string | number
	filename?: unknown
	mimeType?: unknown
	filesize?: unknown
	url?: unknown
}

export type ResolveFileRefResult = { ok: true; ref: FileRef } | { ok: false; code: FileRefError }

const mimeAllowed = (mimeType: string, allow: string[] | undefined): boolean => {
	if (!allow || allow.length === 0) {
		return true
	}
	return allow.some((pattern) => {
		if (pattern.endsWith('*')) {
			return mimeType.startsWith(pattern.slice(0, -1))
		}
		return mimeType === pattern
	})
}

/**
 * Pure server trust-boundary check for an uploaded file: given the loaded upload doc (or null) and the
 * field's constraints, either return an authoritative `FileRef` snapshot or a rejection code. Never trusts
 * client metadata; the caller passes the doc it loaded from the upload collection.
 */
export const resolveFileRef = (
	doc: UploadDoc | null | undefined,
	config: FileFieldConfig
): ResolveFileRefResult => {
	if (doc == null || doc.id == null) {
		return { ok: false, code: 'missing' }
	}
	const mimeType = typeof doc.mimeType === 'string' ? doc.mimeType : ''
	const filesize = typeof doc.filesize === 'number' ? doc.filesize : 0
	if (!mimeAllowed(mimeType, config.mimeTypes)) {
		return { ok: false, code: 'mimeType' }
	}
	if (typeof config.maxSize === 'number' && filesize > config.maxSize) {
		return { ok: false, code: 'tooLarge' }
	}
	const ref: FileRef = {
		id: doc.id,
		filename: typeof doc.filename === 'string' ? doc.filename : '',
		mimeType,
		filesize,
	}
	if (typeof doc.url === 'string' && doc.url.length > 0) {
		ref.url = doc.url
	}
	return { ok: true, ref }
}
