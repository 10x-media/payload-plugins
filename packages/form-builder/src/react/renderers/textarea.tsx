'use client'

import { useId } from 'react'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'
import { Textarea } from '../primitives/Textarea'

export const textareaRenderer = defineFieldRenderer<string>(
	({ field, name, value, onChange, onBlur, errors, required, disabled }) => {
		const id = useId()
		const describedById = `${id}-desc`
		return (
			<FieldShell
				id={id}
				label={field.label}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				describedById={describedById}
			>
				<Textarea
					id={id}
					name={name}
					value={value ?? ''}
					onChange={onChange}
					onBlur={onBlur}
					placeholder={typeof field.placeholder === 'string' ? field.placeholder : undefined}
					required={required}
					disabled={disabled}
					invalid={errors.length > 0}
					describedById={describedById}
				/>
			</FieldShell>
		)
	}
)
