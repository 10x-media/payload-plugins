/** The built-in viewers, one chunk each. */
export type ViewerKind =
	| 'audio'
	| 'csv'
	| 'docx'
	| 'image'
	| 'markdown'
	| 'pdf'
	| 'pptx'
	| 'text'
	| 'video'
	| 'xlsx'

/**
 * Which built-in viewer takes which mime pattern. Images are listed by exact
 * mime because `image/*` would claim TIFF and HEIC, which browsers cannot
 * decode. Plain data so the server half (the file panel's mime map) can read it
 * without loading a viewer.
 */
export const BUILT_IN_VIEWERS: Readonly<Record<string, ViewerKind>> = {
	'application/json': 'text',
	'application/javascript': 'text',
	'application/pdf': 'pdf',
	'application/sql': 'text',
	'application/vnd.ms-excel': 'xlsx',
	'application/vnd.ms-excel.sheet.macroEnabled.12': 'xlsx',
	'application/vnd.ms-powerpoint': 'pptx',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/xml': 'text',
	'application/yaml': 'text',
	'audio/*': 'audio',
	'image/avif': 'image',
	'image/bmp': 'image',
	'image/gif': 'image',
	'image/jpeg': 'image',
	'image/png': 'image',
	'image/svg+xml': 'image',
	'image/vnd.microsoft.icon': 'image',
	'image/webp': 'image',
	'image/x-icon': 'image',
	'text/*': 'text',
	'text/csv': 'csv',
	'text/markdown': 'markdown',
	'text/tab-separated-values': 'csv',
	'video/*': 'video',
}

/** Kinds Payload's own file panel already previews (thumbnail, `<video>`, `<audio>`, PDF iframe). */
export const NATIVE_KINDS: ReadonlySet<ViewerKind> = new Set(['audio', 'image', 'pdf', 'video'])
