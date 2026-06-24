import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import type { FileRef } from '../../uploads/types'
import { defineFormField } from '../defineFormField'

type FileConfig = {
	relationTo?: string
	mimeTypes?: string[]
	maxSize?: number
}

const isFileRef = (value: unknown): value is FileRef =>
	typeof value === 'object' && value !== null && 'filename' in value

/**
 * The `file` field type. Its stored value is a server-captured {@link FileRef}; the client only ever submits
 * the upload id, and `runSubmission` re-reads filename/mimeType/filesize from the upload doc at the trust
 * boundary (see `captureFileRef`). The intrinsic validator is intentionally a no-op: MIME/size/existence are
 * enforced authoritatively server-side against the stored doc, never against client metadata. `relationTo`,
 * `mimeTypes`, and `maxSize` persist on the block so the capture can enforce them.
 */
export const fileField = defineFormField<'file', FileConfig>({
	type: 'file',
	label: keys.fieldTypeFile,
	value: 'file',
	config: [
		{ name: 'relationTo', type: 'text', label: labelFor(keys.fileConfigRelationTo) },
		{ name: 'mimeTypes', type: 'text', hasMany: true, label: labelFor(keys.fileConfigMimeTypes) },
		{ name: 'maxSize', type: 'number', label: labelFor(keys.fileConfigMaxSize) },
	],
	format: ({ value }) => (isFileRef(value) ? value.filename : ''),
})
