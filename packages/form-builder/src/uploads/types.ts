/** A self-describing reference to an uploaded file, captured server-side and stored as the field's value. */
export type FileRef = {
	id: string | number
	filename: string
	mimeType: string
	filesize: number
	url?: string
}

/** Per-field file constraints, authored in the field config. */
export type FileFieldConfig = {
	/** Allowed MIME types (exact match or a `type/*` wildcard). Empty/absent allows any. */
	mimeTypes?: string[]
	/** Maximum file size in bytes. Absent allows any size (subject to the collection limit). */
	maxSize?: number
}

/** Why a file reference was rejected at the server trust boundary. */
export type FileRefError = 'missing' | 'mimeType' | 'tooLarge'
