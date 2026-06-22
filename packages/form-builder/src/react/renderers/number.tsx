'use client'

import { useId } from 'react'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'
import { Input } from '../primitives/Input'

export const numberRenderer = defineFieldRenderer<number | undefined>(
	({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
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
				<Input
					id={id}
					name={name}
					type="number"
					value={value == null ? '' : String(value)}
					onChange={(raw) => {
						const next = Number(raw)
						onChange(raw === '' || Number.isNaN(next) ? undefined : next)
					}}
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
