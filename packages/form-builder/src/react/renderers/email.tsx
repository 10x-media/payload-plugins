'use client'

import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'
import { Input } from '../primitives/Input'

export const emailRenderer = defineFieldRenderer<string>(
	({ field, id, name, value, onChange, onBlur, errors, required, disabled }) => {
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
				<Input
					id={id}
					name={name}
					type="email"
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
