'use client'

import { type ChangeEvent, useId, useState } from 'react'
import { keys } from '../../translations/keys'
import { formatBytes } from '../../uploads/formatBytes'
import { resolveMessage } from '../../validation/message'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'
import { uploadFile } from '../uploadFile'

const typesOf = (mimeTypes: unknown): string[] => {
	if (!Array.isArray(mimeTypes)) {
		return []
	}
	return mimeTypes.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Headless file renderer: a native file input that uploads the chosen file to the upload collection and
 * stores the returned id as the field value. The server re-derives filename/mimeType/filesize from the
 * stored doc at submit, so the client value is only the id. Shows the uploaded filename with a clear
 * control and surfaces upload errors. Single file (v1); the upload posts to the default `/api` route.
 */
export const fileRenderer = defineFieldRenderer<string | number>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled, t }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const [uploading, setUploading] = useState(false)
		const [filename, setFilename] = useState<string | undefined>(undefined)
		const [localError, setLocalError] = useState<string | undefined>(undefined)

		const collection = typeof field.relationTo === 'string' ? field.relationTo : 'form-uploads'
		const types = typesOf(field.mimeTypes)
		const accept = types.length > 0 ? types.join(',') : undefined
		// Zero is a real limit, matching resolveFileRef server-side (filesize > maxSize rejects any non-empty file).
		const maxSize =
			typeof field.maxSize === 'number' && field.maxSize >= 0 ? field.maxSize : undefined
		const hints = [
			types.length > 0
				? resolveMessage(t(keys.fileHintAccepted), { types: types.join(', ') })
				: undefined,
			maxSize !== undefined
				? resolveMessage(t(keys.fileHintMaxSize), { max: formatBytes(maxSize) })
				: undefined,
		].filter((hint): hint is string => typeof hint === 'string')
		const allErrors = localError ? [...errors, localError] : errors
		// Show the just-uploaded filename, or a generic indicator when the field already holds an id (recall/prefill): the filename is not part of the client value.
		const hasValue = value !== undefined && value !== null && value !== ''
		const displayName = filename ?? (hasValue ? 'Uploaded file' : undefined)

		const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
			const selected = event.target.files?.[0]
			if (!selected) {
				return
			}
			if (maxSize !== undefined && selected.size > maxSize) {
				setLocalError(resolveMessage(t(keys.fileTooLarge), { max: formatBytes(maxSize) }))
				return
			}
			setUploading(true)
			setLocalError(undefined)
			const result = await uploadFile({ file: selected, collection })
			setUploading(false)
			if (result.ok) {
				setFilename(selected.name)
				onChange(result.id)
			} else {
				setLocalError(result.message ?? 'Upload failed')
			}
		}

		const clear = () => {
			setFilename(undefined)
			setLocalError(undefined)
			onChange('')
		}

		return (
			<FieldShell
				id={id}
				label={field.label}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={allErrors}
				warnings={warnings}
				describedById={describedById}
			>
				<input
					id={id}
					name={name}
					type="file"
					accept={accept}
					disabled={disabled || uploading}
					onChange={(event) => {
						void handleChange(event)
					}}
					onBlur={onBlur}
					aria-invalid={allErrors.length > 0}
					aria-describedby={describedById}
				/>
				{hints.length > 0 ? <p className="fb-field__file-hint">{hints.join(' · ')}</p> : null}
				{uploading ? (
					<p className="fb-field__file-status" aria-live="polite">
						Uploading
					</p>
				) : null}
				{displayName ? (
					<p className="fb-field__file-name">
						<span>{displayName}</span>
						<button
							type="button"
							className="fb-field__file-clear"
							onClick={clear}
							disabled={disabled}
						>
							Remove
						</button>
					</p>
				) : null}
			</FieldShell>
		)
	}
)
