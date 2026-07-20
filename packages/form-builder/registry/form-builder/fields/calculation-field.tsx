'use client'

import { defineFieldRenderer } from '@10x-media/form-builder/react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'

/** Read-only renderer for a calculation field: the value is derived, never user-editable, so it
 * shows in an `<output>` rather than an input. */
export const calculationField = defineFieldRenderer<number | undefined>(
	({ field, value, errors, required }) => {
		const id = useId()
		const describedById = `${id}-desc`
		const label = typeof field.label === 'string' ? field.label : undefined
		const description = typeof field.description === 'string' ? field.description : undefined

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
				<output
					id={id}
					aria-describedby={describedById}
					className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 py-1 text-sm"
				>
					{value == null ? '' : String(value)}
				</output>
				<div id={describedById} className="grid gap-1 text-sm">
					{description ? <p className="text-muted-foreground">{description}</p> : null}
					{errors.length > 0 ? (
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
