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

const MAX_SIZE_REF = '@10x-media/form-builder/client#ByteSizeField'

/**
 * Curated MIME type choices for the file field's `mimeTypes` select. Values are raw MIME strings or
 * `type/*` wildcards, exactly the patterns `resolveFileRef` matches server-side and the file input's
 * `accept` attribute understands client-side.
 */
export const fileMimeTypeOptions = [
	{ label: 'Any image', value: 'image/*' },
	{ label: 'PNG image', value: 'image/png' },
	{ label: 'JPEG image', value: 'image/jpeg' },
	{ label: 'WebP image', value: 'image/webp' },
	{ label: 'GIF image', value: 'image/gif' },
	{ label: 'SVG image', value: 'image/svg+xml' },
	{ label: 'PDF', value: 'application/pdf' },
	{ label: 'Plain text', value: 'text/plain' },
	{ label: 'CSV', value: 'text/csv' },
	{ label: 'ZIP archive', value: 'application/zip' },
	{ label: 'Word document (.doc)', value: 'application/msword' },
	{
		label: 'Word document (.docx)',
		value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	},
	{ label: 'Excel spreadsheet (.xls)', value: 'application/vnd.ms-excel' },
	{
		label: 'Excel spreadsheet (.xlsx)',
		value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	},
	{ label: 'Any audio', value: 'audio/*' },
	{ label: 'Any video', value: 'video/*' },
]

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
		{
			name: 'mimeTypes',
			type: 'select',
			hasMany: true,
			options: fileMimeTypeOptions,
			label: labelFor(keys.fileConfigMimeTypes),
		},
		{
			name: 'maxSize',
			type: 'number',
			min: 0,
			label: labelFor(keys.fileConfigMaxSize),
			admin: {
				description: labelFor(keys.fileConfigMaxSizeDescription),
				components: { Field: MAX_SIZE_REF },
			},
		},
	],
	format: ({ value }) => (isFileRef(value) ? value.filename : ''),
})
