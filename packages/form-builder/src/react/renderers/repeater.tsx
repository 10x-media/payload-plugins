'use client'

import { createElement, useId, useRef } from 'react'
import { isNamedField } from '../../fields/fieldKey'
import type { FormFieldInstance } from '../../submissions/types'
import { keys } from '../../translations/keys'
import type { FieldRenderer } from '../contract'
import { defineFieldRenderer } from '../contract'
import { useFormContext } from '../FormContext'
import { FieldShell } from '../primitives/FieldShell'
import { useField } from '../useField'

type RepeaterRow = Record<string, unknown>

/** Process-wide counter for stable per-row React keys (rows are plain objects with no id of their own). */
let rowKeySeq = 0
const nextRowKey = () => `fbrow-${rowKeySeq++}`

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
		const { rendererRegistry, dispatch } = useFormContext()
		const { value, setValue, onBlur } = useField<RepeaterRow[]>(name)
		const addId = useId()
		const rowKeysRef = useRef<string[]>([])

		const rows = Array.isArray(value) ? value : []
		// One stable key per row so removing a middle row does not re-index survivors onto each other's
		// React instances (which would strand a stateful sub-renderer's local state, e.g. the file
		// renderer's filename). Reconciled to the row count each render; add/remove keep keys aligned.
		if (rowKeysRef.current.length !== rows.length) {
			const next = rowKeysRef.current.slice(0, rows.length)
			while (next.length < rows.length) next.push(nextRowKey())
			rowKeysRef.current = next
		}
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
			rowKeysRef.current = [...rowKeysRef.current, nextRowKey()]
			setValue([...rows, {}])
			onBlur()
		}

		const removeRow = (index: number) => {
			rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== index)
			setValue(rows.filter((_, i) => i !== index))
			onBlur()
		}

		const updateRow = (index: number, fieldName: string, fieldValue: unknown) => {
			setValue(rows.map((row, i) => (i === index ? { ...row, [fieldName]: fieldValue } : row)))
			// SET_VALUE clears only the repeater field's own error key, not composite sub-field keys, so a
			// stale server-side error for this sub-field would linger until the next submit. Clear it now.
			dispatch({ type: 'SET_FIELD_ISSUES', name: `${name}[${index}].${fieldName}`, errors: [] })
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
							<fieldset key={rowKeysRef.current[rowIndex]} className="fb-repeater__row">
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
