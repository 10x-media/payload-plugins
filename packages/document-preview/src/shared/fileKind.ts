import { codeLanguage } from './codeLanguage'

/** The coarse family a file belongs to, which picks its icon. */
export type FileKind =
	| 'archive'
	| 'audio'
	| 'code'
	| 'csv'
	| 'file'
	| 'image'
	| 'json'
	| 'markdown'
	| 'pdf'
	| 'sheet'
	| 'slides'
	| 'text'
	| 'video'
	| 'word'

const BY_MIME: Record<string, FileKind> = {
	'application/gzip': 'archive',
	'application/msword': 'word',
	'application/pdf': 'pdf',
	'application/rtf': 'word',
	'application/vnd.ms-excel': 'sheet',
	'application/vnd.ms-excel.sheet.macroEnabled.12': 'sheet',
	'application/vnd.ms-powerpoint': 'slides',
	'application/vnd.oasis.opendocument.presentation': 'slides',
	'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
	'application/vnd.oasis.opendocument.text': 'word',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
	'application/vnd.rar': 'archive',
	'application/x-7z-compressed': 'archive',
	'application/x-bzip2': 'archive',
	'application/x-rar-compressed': 'archive',
	'application/x-tar': 'archive',
	'application/x-zip-compressed': 'archive',
	'application/zip': 'archive',
	'text/csv': 'csv',
	'text/markdown': 'markdown',
	'text/rtf': 'word',
	'text/tab-separated-values': 'csv',
}

const BY_TYPE: Record<string, FileKind> = {
	audio: 'audio',
	image: 'image',
	video: 'video',
}

/**
 * The family of a file from its (already resolved) mime, falling back to the
 * extension for code: source files often arrive as `text/plain` or with no
 * useful mime at all, and their extension is the better signal.
 */
export const fileKind = (mimeType: string, filename: string): FileKind => {
	const exact = BY_MIME[mimeType]
	if (exact) {
		return exact
	}
	const byType = BY_TYPE[mimeType.slice(0, mimeType.indexOf('/'))]
	if (byType) {
		return byType
	}
	const language = codeLanguage(filename, mimeType)
	if (language === 'markdown' || language === 'json') {
		return language
	}
	if (language !== 'plaintext') {
		return 'code'
	}
	return mimeType.startsWith('text/') ? 'text' : 'file'
}

/** Every family, in the order a gallery shows them. */
export const FILE_KINDS: readonly FileKind[] = [
	'pdf',
	'word',
	'sheet',
	'slides',
	'csv',
	'text',
	'markdown',
	'json',
	'code',
	'image',
	'audio',
	'video',
	'archive',
	'file',
]

const KIND_SET: ReadonlySet<string> = new Set(FILE_KINDS)

export const isFileKind = (value: string): value is FileKind => KIND_SET.has(value)
