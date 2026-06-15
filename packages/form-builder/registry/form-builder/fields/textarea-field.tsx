'use client'

import { defineFieldRenderer } from '@10x-media/form-builder/react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export const textareaField = defineFieldRenderer<string>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const invalid = errors.length > 0
		const label = typeof field.label === 'string' ? field.label : undefined
		const description = typeof field.description === 'string' ? field.description : undefined
		const placeholder = typeof field.placeholder === 'string' ? field.placeholder : undefined

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
				<Textarea
					id={id}
					name={name}
					value={value ?? ''}
					placeholder={placeholder}
					required={required}
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedById}
					className={cn(invalid && 'border-destructive focus-visible:ring-destructive')}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onBlur}
				/>
				<div id={describedById} className="grid gap-1 text-sm">
					{description ? <p className="text-muted-foreground">{description}</p> : null}
					{invalid ? (
						<div aria-atomic className="text-destructive" role="alert">
							{errors.map((message) => (
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
