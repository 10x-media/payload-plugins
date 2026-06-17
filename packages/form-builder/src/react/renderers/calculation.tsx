'use client'

import { useId } from 'react'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'

/** Read-only renderer for a calculation field: the value is derived, never user-editable, so it shows in an `<output>` rather than an input. */
export const calculationRenderer = defineFieldRenderer<number | undefined>(
	({ field, name, value, errors, warnings, required }) => {
		const id = useId()
		const describedById = `${id}-desc`
		return (
			<FieldShell
				id={id}
				label={field.label}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				warnings={warnings}
				describedById={describedById}
			>
				<output id={id} htmlFor={name} className="fb-field__calc" aria-describedby={describedById}>
					{value == null ? '' : String(value)}
				</output>
			</FieldShell>
		)
	}
)
