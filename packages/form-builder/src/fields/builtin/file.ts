import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import type { FileRef } from '../../uploads/types'
import { defineFormField } from '../defineFormField'

type FileConfig = {
	uploadsCollection?: string
	mimeTypes?: string[]
	maxSize?: number
}

const isFileRef = (value: unknown): value is FileRef =>
	typeof value === 'object' && value !== null && 'filename' in value

const MAX_SIZE_REF = '@10x-media/form-builder/client#ByteSizeField'

/**
 * Curated MIME type choices for the file field's `mimeTypes` select. Values are raw MIME strings or
 * trailing-`*` prefix wildcards, exactly the patterns `resolveFileRef` matches server-side; `type/*`
 * values double as the file input's `accept` attribute (browsers ignore other prefix patterns, which
 * is fine since the server stays authoritative). Every value must be 63 bytes or less: Payload's
 * db-postgres adapter stores select options as a pg enum, and pg enum labels cap at 63 bytes.
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
	{ label: 'Excel spreadsheet (.xls)', value: 'application/vnd.ms-excel' },
	{
		label: 'Office documents (docx, xlsx, pptx)',
		value: 'application/vnd.openxmlformats-officedocument.*',
	},
	{ label: 'Any audio', value: 'audio/*' },
	{ label: 'Any video', value: 'video/*' },
]

/**
 * The `file` field type. Its stored value is a server-captured {@link FileRef}; the client only ever submits
 * the upload id, and `runSubmission` re-reads filename/mimeType/filesize from the upload doc at the trust
 * boundary (see `captureFileRef`). The intrinsic validator is intentionally a no-op: MIME/size/existence are
 * enforced authoritatively server-side against the stored doc, never against client metadata. `mimeTypes`
 * and `maxSize` persist on the block so the capture can enforce them. `uploadsCollection` is not
 * author-editable: a forms hook stamps the plugin-configured uploads collection slug onto it on every save
 * so the client renderer knows where to POST; the server never trusts it at submit time (plugin config
 * stays the source of truth). Named `uploadsCollection` because `collection` is a mongoose-reserved
 * schema pathname.
 */
export const fileField = defineFormField<'file', FileConfig>({
	type: 'file',
	label: keys.fieldTypeFile,
	value: 'file',
	config: [
		{ name: 'uploadsCollection', type: 'text', admin: { hidden: true } },
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
