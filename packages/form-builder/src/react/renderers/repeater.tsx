'use client'

import { createElement, useId } from 'react'
import { isNamedField } from '../../fields/fieldKey'
import type { FormFieldInstance } from '../../submissions/types'
import { keys } from '../../translations/keys'
import type { FieldRenderer } from '../contract'
import { defineFieldRenderer } from '../contract'
import { useFormContext } from '../FormContext'
import { FieldShell } from '../primitives/FieldShell'
import { useField } from '../useField'

type RepeaterRow = Record<string, unknown>

/**
 * Thin wrapper so each sub-field renderer is a proper React component (has stable hook identity
 * per row/field). Reads errors for the composite path `field[row].subField` from
 * form state so server-side validation errors are surfaced inline next to the sub-field input,
 * overriding any static values passed by the parent.
 */
const SubFieldWrapper = ({
	renderer,
	name,
	...props
}: { renderer: FieldRenderer } & Parameters<FieldRenderer>[0]) => {
	const { state } = useFormContext()
	const errors = (state.errors as Record<string, string[]>)?.[name] ?? []
	return renderer({ ...props, name, errors })
}

export const repeaterRenderer = defineFieldRenderer<RepeaterRow[]>(
	({ field, name, id: rootId, errors, required, t, locale }) => {
		const { rendererRegistry } = useFormContext()
		const { value, setValue, onBlur } = useField<RepeaterRow[]>(name)
		const addId = useId()

		const rows = Array.isArray(value) ? value : []
		const subFields = (
			Array.isArray(field.subFields) ? (field.subFields as FormFieldInstance[]) : []
		).filter(isNamedField)
		const maxRows = typeof field.maxRows === 'number' ? field.maxRows : undefined
		const minRows = typeof field.minRows === 'number' ? field.minRows : 0
		const addLabel =
			typeof field.addLabel === 'string' && field.addLabel.length > 0
				? field.addLabel
				: t(keys.repeaterAddRow)

		const addRow = () => {
			if (maxRows != null && rows.length >= maxRows) return
			setValue([...rows, {}])
			onBlur()
		}

		const removeRow = (index: number) => {
			setValue(rows.filter((_, i) => i !== index))
			onBlur()
		}

		const updateRow = (index: number, fieldName: string, fieldValue: unknown) => {
			setValue(rows.map((row, i) => (i === index ? { ...row, [fieldName]: fieldValue } : row)))
		}

		return (
			<FieldShell
				id={rootId}
				label={typeof field.label === 'string' ? field.label : undefined}
				description={typeof field.description === 'string' ? field.description : undefined}
				required={required}
				errors={errors}
				describedById={`${rootId}-desc`}
			>
				<div className="fb-repeater">
					{rows.map((row, rowIndex) => {
						const rowLabel = t(keys.repeaterRow).replace('{n}', String(rowIndex + 1))
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: repeater rows have no stable ID; index key is intentional
							<fieldset key={rowIndex} className="fb-repeater__row">
								<legend className="fb-repeater__row-legend">
									{rowLabel}
									{rows.length > minRows && (
										<button
											type="button"
											className="fb-repeater__remove"
											onClick={() => removeRow(rowIndex)}
											aria-label={`${t(keys.repeaterRemoveRow)} ${rowLabel}`}
										>
											{t(keys.repeaterRemoveRow)}
										</button>
									)}
								</legend>
								<div className="fb-repeater__row-fields">
									{subFields.map((subField) => {
										const renderer = rendererRegistry.get(subField.blockType)
										if (!renderer) return null
										const subId = `${rootId}-${rowIndex}-${subField.name}`
										const compositeName = `${name}[${rowIndex}].${subField.name}`
										return (
											<div key={subField.name} className="fb-repeater__sub-field">
												{createElement(SubFieldWrapper, {
													renderer,
													field: subField,
													id: subId,
													name: compositeName,
													value: row[subField.name],
													onChange: (v) => updateRow(rowIndex, subField.name, v),
													onBlur,
													// SubFieldWrapper overrides these from form state; passed here to satisfy the type
													errors: [],
													required: subField.required ?? false,
													disabled: false,
													locale,
													t,
												})}
											</div>
										)
									})}
								</div>
							</fieldset>
						)
					})}
					{(maxRows == null || rows.length < maxRows) && (
						<button id={addId} type="button" className="fb-repeater__add" onClick={addRow}>
							{addLabel}
						</button>
					)}
				</div>
			</FieldShell>
		)
	}
)
