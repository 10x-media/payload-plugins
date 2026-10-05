/** Mime types for the extensions this plugin can preview, used when an upload carries no usable mime. */
const EXTENSION_MIME: Record<string, string> = {
	'7z': 'application/x-7z-compressed',
	avif: 'image/avif',
	bmp: 'image/bmp',
	csv: 'text/csv',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	gif: 'image/gif',
	gz: 'application/gzip',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	json: 'application/json',
	log: 'text/plain',
	m4a: 'audio/mp4',
	md: 'text/markdown',
	mov: 'video/quicktime',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	ogg: 'audio/ogg',
	pdf: 'application/pdf',
	png: 'image/png',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	rar: 'application/vnd.rar',
	svg: 'image/svg+xml',
	tar: 'application/x-tar',
	tsv: 'text/tab-separated-values',
	txt: 'text/plain',
	wav: 'audio/wav',
	webm: 'video/webm',
	webp: 'image/webp',
	xls: 'application/vnd.ms-excel',
	xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xml: 'application/xml',
	yaml: 'application/yaml',
	yml: 'application/yaml',
	zip: 'application/zip',
}

/**
 * Extensions whose reported mime is unreliable, so the extension wins. Windows
 * reports `.csv` as `application/vnd.ms-excel`, which would route a plain text
 * table into the spreadsheet viewer.
 */
const EXTENSION_WINS = new Set(['csv', 'tsv'])

/** Mimes that say nothing about the content and are treated as missing. */
const OPAQUE_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

const extensionOf = (filename: null | string | undefined): string | undefined => {
	if (!filename) {
		return undefined
	}
	const dot = filename.lastIndexOf('.')
	return dot === -1 ? undefined : filename.slice(dot + 1).toLowerCase()
}

/**
 * The mime a preview is chosen by: the stored mime, unless it is opaque or the
 * extension is known to be misreported, in which case the extension decides.
 * Parameters (`; charset=utf-8`) are dropped and the result is lowercased.
 */
export const resolveMimeType = (
	mimeType: null | string | undefined,
	filename: null | string | undefined
): string => {
	const extension = extensionOf(filename)
	const fromExtension = extension ? EXTENSION_MIME[extension] : undefined
	const stored = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
	if (extension && EXTENSION_WINS.has(extension) && fromExtension) {
		return fromExtension
	}
	if (OPAQUE_MIMES.has(stored)) {
		return fromExtension ?? stored
	}
	return stored
}
