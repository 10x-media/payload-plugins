import type { ConversationMessage } from '../types'

export const ATTACHMENTS = 'attachments'

/**
 * Set on an upload a composer makes, to the instance slug: the collection's
 * `data` hook runs for these only. `key` and `channel` travel along for it.
 */
export const ATTACHMENT_HEADER = 'x-conversations-attachment'
export const ATTACHMENT_KEY_HEADER = 'x-conversations-key'
export const ATTACHMENT_CHANNEL_HEADER = 'x-conversations-channel'

/** One attached file as clients see it, at `message.ext.attachments`. */
export type AttachmentView = {
	filename: string
	filesize: null | number
	height: null | number
	id: number | string
	mimeType: null | string
	/** A smaller image to show in the message (`thumbnail` option), else null. */
	thumbnail: null | string
	url: null | string
	width: null | number
}

/** What the browser knows of the extension: `useExtension('attachments')`. */
export type AttachmentsClientData = {
	/** The upload collection files go to, through its own REST endpoint and access. */
	collection: string
	maxFiles: number
	/** The collection's `upload.mimeTypes`; empty takes any file. */
	mimeTypes: string[]
}

/** A message's attached files, in the order they were attached. */
export const attachmentsOf = (message: Pick<ConversationMessage, 'ext'>): AttachmentView[] => {
	const value = message.ext?.[ATTACHMENTS]
	return Array.isArray(value) ? (value as AttachmentView[]) : []
}

export const isImage = (file: { mimeType: null | string }): boolean =>
	Boolean(file.mimeType?.startsWith('image/'))

/** Whether a file's type is one of `mimeTypes` (`image/*` style wildcards), as Payload checks it. */
export const acceptsType = (mimeTypes: string[], type: string): boolean =>
	mimeTypes.length === 0 ||
	mimeTypes.some((pattern) =>
		pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : pattern === type
	)

/** `1.2 MB`, `830 KB`. */
export const formatSize = (bytes: null | number): string => {
	if (bytes === null || !Number.isFinite(bytes)) return ''
	if (bytes < 1024) return `${bytes} B`
	const units = ['KB', 'MB', 'GB']
	let value = bytes / 1024
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit += 1
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
