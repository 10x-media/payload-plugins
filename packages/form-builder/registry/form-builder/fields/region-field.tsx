'use client'

import { COUNTRIES, defineFieldRenderer, US_STATES } from '@10x-media/form-builder/react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * A `<select>` over a fixed, code-supplied option set for the `country` and `state` field types,
 * whose choices live in the plugin rather than in per-instance `options`. Mirrors `selectField` but
 * takes the options as an argument; the stored value is one of the fixed codes. The option labels are
 * the English names shipped with the plugin and are intentionally not localized.
 */
const regionField = (options: { label: string; value: string }[]) =>
	defineFieldRenderer<string>(
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
					<select
						id={id}
						name={name}
						value={value ?? ''}
						required={required}
						disabled={disabled}
						aria-invalid={invalid || undefined}
						aria-describedby={describedById}
						className={cn(
							'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
							invalid && 'border-destructive focus-visible:ring-destructive'
						)}
						onChange={(event) => onChange(event.target.value)}
						onBlur={onBlur}
					>
						{placeholder !== undefined ? <option value="">{placeholder}</option> : null}
						{options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
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

export const countryField = regionField(COUNTRIES)
export const stateField = regionField(US_STATES)
