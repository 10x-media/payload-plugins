'use client'

import { defineFieldRenderer, uploadFile } from '@10x-media/form-builder/react'
import { type ChangeEvent, useId, useState } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const acceptOf = (mimeTypes: unknown): string | undefined => {
	if (!Array.isArray(mimeTypes)) {
		return undefined
	}
	const types = mimeTypes.filter((entry): entry is string => typeof entry === 'string')
	return types.length > 0 ? types.join(',') : undefined
}

export const fileField = defineFieldRenderer<string | number>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const label = typeof field.label === 'string' ? field.label : undefined
		const description = typeof field.description === 'string' ? field.description : undefined
		const collection = typeof field.relationTo === 'string' ? field.relationTo : 'form-uploads'
		const accept = acceptOf(field.mimeTypes)

		const [uploading, setUploading] = useState(false)
		const [filename, setFilename] = useState<string | undefined>(undefined)
		const [localError, setLocalError] = useState<string | undefined>(undefined)
		const hasValue = value !== undefined && value !== null && value !== ''
		const displayName = filename ?? (hasValue ? 'Uploaded file' : undefined)
		const allErrors = localError ? [...errors, localError] : errors
		const invalid = allErrors.length > 0

		const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
			const selected = event.target.files?.[0]
			if (!selected) {
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
			<div className="grid gap-2">
				{label ? (
					<Label htmlFor={id}>
						{label}
						{required ? (
							<span aria-hidden className="text-destructive">
								{' *'}
							</span>
						) : null}
					</Label>
				) : null}
				<input
					id={id}
					name={name}
					type="file"
					accept={accept}
					disabled={disabled || uploading}
					aria-invalid={invalid || undefined}
					aria-describedby={describedById}
					className={cn('text-sm', invalid && 'text-destructive')}
					onChange={(event) => {
						void handleChange(event)
					}}
					onBlur={onBlur}
				/>
				{uploading ? (
					<p aria-live="polite" className="text-sm text-muted-foreground">
						Uploading
					</p>
				) : null}
				{displayName ? (
					<p className="flex items-center gap-2 text-sm">
						<span>{displayName}</span>
						<button
							type="button"
							className="text-destructive underline"
							onClick={clear}
							disabled={disabled}
						>
							Remove
						</button>
					</p>
				) : null}
				<div id={describedById} className="grid gap-1 text-sm">
					{description ? <p className="text-muted-foreground">{description}</p> : null}
					{invalid ? (
						<div aria-atomic className="text-destructive" role="alert">
							{allErrors.map((message) => (
								<p key={message}>{message}</p>
							))}
						</div>
					) : null}
					{warnings?.map((message) => (
						<p key={message} className="text-amber-600">
							{message}
						</p>
					))}
				</div>
			</div>
		)
	}
)
