'use client'

import { defineFieldRenderer } from '../contract'
import { ChoiceGroup } from '../primitives/ChoiceGroup'
import { FieldShell } from '../primitives/FieldShell'
import { Select } from '../primitives/Select'

export const selectRenderer = defineFieldRenderer<string>(
	({ field, id, name, value, onChange, onBlur, errors, required, disabled }) => {
		const describedById = `${id}-desc`
		const options = (
			Array.isArray(field.options) ? (field.options as { label?: string; value: string }[]) : []
		).map((option) => ({
			value: option.value,
			label: option.label?.trim() ? option.label : option.value,
		}))
		const display =
			field.display === 'radio' || field.display === 'buttons' ? field.display : 'dropdown'
		return (
			<FieldShell
				id={id}
				label={field.label}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				describedById={describedById}
				group={display !== 'dropdown'}
			>
				{display === 'dropdown' ? (
					<Select
						id={id}
						name={name}
						value={value ?? ''}
						options={options}
						onChange={onChange}
						onBlur={onBlur}
						placeholder={typeof field.placeholder === 'string' ? field.placeholder : undefined}
						required={required}
						disabled={disabled}
						invalid={errors.length > 0}
						describedById={describedById}
					/>
				) : (
					<ChoiceGroup
						name={name}
						value={value ?? ''}
						options={options}
						onChange={onChange}
						onBlur={onBlur}
						required={required}
						disabled={disabled}
						invalid={errors.length > 0}
						describedById={describedById}
						labelledById={field.label ? `${id}-label` : undefined}
						variant={display}
					/>
				)}
			</FieldShell>
		)
	}
)
