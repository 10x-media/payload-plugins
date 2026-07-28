'use client'

import { formatCalcValue } from '../../calc/formatCalcValue'
import { defineFieldRenderer } from '../contract'
import { FieldShell } from '../primitives/FieldShell'

/** Read-only renderer for a calculation field: the value is derived, never user-editable, so it shows in an `<output>` rather than an input. */
export const calculationRenderer = defineFieldRenderer<number | undefined>(
	({ field, id, value, errors, required }) => {
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
				<output id={id} className="fb-field__calc" aria-describedby={describedById}>
					{value == null
						? ''
						: formatCalcValue(value, {
								decimals: field.decimals,
								prefix: field.prefix,
								suffix: field.suffix,
							})}
				</output>
			</FieldShell>
		)
	}
)
