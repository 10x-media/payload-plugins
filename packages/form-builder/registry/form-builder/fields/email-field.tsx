'use client'

import { defineFieldRenderer } from '@10x-media/form-builder/react'
import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const emailField = defineFieldRenderer<string>(
	({ field, name, value, onChange, onBlur, errors, required, disabled }) => {
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
				<Input
					id={id}
					name={name}
					type="email"
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
				</div>
			</div>
		)
	}
)
