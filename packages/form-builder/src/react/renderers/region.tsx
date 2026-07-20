'use client'

import { useId } from 'react'
import { COUNTRIES, US_STATES } from '../../fields/data/regions'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'
import { Select, type SelectOption } from '../primitives/Select'

/**
 * A `<select>` over a fixed, code-supplied option set, for field types (country/state) whose choices
 * live in the plugin rather than in per-instance `options`. Mirrors `selectRenderer` but takes the
 * options as a closure argument instead of reading `field.options`, so the stored value is one of the
 * fixed codes and the placeholder still gates the empty selection.
 */
const regionRenderer = (options: SelectOption[]) =>
	defineFieldRenderer<string>(
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
				</FieldShell>
			)
		}
	)

export const countryRenderer = regionRenderer(COUNTRIES)
export const stateRenderer = regionRenderer(US_STATES)
