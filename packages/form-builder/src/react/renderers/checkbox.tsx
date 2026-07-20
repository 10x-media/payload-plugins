'use client'

import { useId } from 'react'
import { defineFieldRenderer } from '../contract'
import { Checkbox } from '../primitives/Checkbox'
import { FieldShell } from '../primitives/FieldShell'

export const checkboxRenderer = defineFieldRenderer<boolean>(
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
				<Checkbox
					id={id}
					name={name}
					checked={value ?? false}
					onChange={onChange}
					onBlur={onBlur}
					required={required}
					disabled={disabled}
					invalid={errors.length > 0}
					describedById={describedById}
				/>
			</FieldShell>
		)
	}
)
