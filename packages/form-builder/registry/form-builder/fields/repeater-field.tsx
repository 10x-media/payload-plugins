'use client'

import {
	defineFieldRenderer,
	type FieldRenderer,
	type FormFieldInstance,
	useFormContext,
} from '@10x-media/form-builder/react'
import { createElement, useId } from 'react'
import { cn } from '@/lib/utils'

type RepeaterRow = Record<string, unknown>

/**
 * Wraps a sub-field renderer as a proper component so hooks keep stable identity per row/field.
 * Reads errors/warnings for the composite path `field[row].subField` from form state so server-side
 * validation surfaces inline next to the sub-field, overriding the static values the parent passes.
 */
const SubFieldWrapper = ({
	renderer,
	name,
	...props
}: { renderer: FieldRenderer } & Parameters<FieldRenderer>[0]) => {
	const { state } = useFormContext()
	const errors = (state.errors as Record<string, string[]>)?.[name] ?? []
	const warnings = (state.warnings as Record<string, string[]>)?.[name] ?? []
	return renderer({ ...props, name, errors, warnings })
}

export const repeaterField = defineFieldRenderer<RepeaterRow[]>(
	({ field, id: rootId, value, onChange, onBlur, errors, warnings, required, locale, t }) => {
		const { rendererRegistry } = useFormContext()
		const addId = useId()
		const invalid = errors.length > 0
		const label = typeof field.label === 'string' ? field.label : undefined
		const description = typeof field.description === 'string' ? field.description : undefined

		const rows = Array.isArray(value) ? value : []
		const subFields = Array.isArray(field.subFields) ? (field.subFields as FormFieldInstance[]) : []
		const maxRows = typeof field.maxRows === 'number' ? field.maxRows : undefined
		const minRows = typeof field.minRows === 'number' ? field.minRows : 0
		const addLabel =
			typeof field.addLabel === 'string' && field.addLabel.length > 0 ? field.addLabel : 'Add row'

		const addRow = () => {
			if (maxRows != null && rows.length >= maxRows) return
			onChange([...rows, {}])
			onBlur()
		}

		const removeRow = (index: number) => {
			onChange(rows.filter((_, i) => i !== index))
			onBlur()
		}

		const updateRow = (index: number, fieldName: string, fieldValue: unknown) => {
			onChange(rows.map((row, i) => (i === index ? { ...row, [fieldName]: fieldValue } : row)))
		}

		return (
			<div className="grid gap-2">
				{label ? (
					<span className="text-sm font-medium leading-none">
						{label}
						{required ? (
							<span aria-hidden className="text-destructive">
								{' *'}
							</span>
						) : null}
					</span>
				) : null}
				<div className="grid gap-4">
					{rows.map((row, rowIndex) => {
						const rowLabel = `Row ${rowIndex + 1}`
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: repeater rows have no stable id; index key is intentional
							<fieldset key={rowIndex} className="grid gap-3 rounded-md border border-input p-4">
								<legend className="flex items-center gap-3 px-1 text-sm font-medium">
									{rowLabel}
									{rows.length > minRows && (
										<button
											type="button"
											className="text-xs text-destructive underline underline-offset-4"
											onClick={() => removeRow(rowIndex)}
											aria-label={`Remove ${rowLabel}`}
										>
											Remove
										</button>
									)}
								</legend>
								<div className="grid gap-3">
									{subFields.map((subField) => {
										const renderer = rendererRegistry.get(subField.blockType)
										if (!renderer) return null
										const subId = `${rootId}-${rowIndex}-${subField.name}`
										const compositeName = `${field.name}[${rowIndex}].${subField.name}`
										return createElement(SubFieldWrapper, {
											key: subField.name,
											renderer,
											field: subField,
											id: subId,
											name: compositeName,
											value: row[subField.name],
											onChange: (fieldValue: unknown) =>
												updateRow(rowIndex, subField.name, fieldValue),
											onBlur,
											// SubFieldWrapper overrides these from form state; passed here to satisfy the type
											errors: [],
											warnings: [],
											required: subField.required ?? false,
											disabled: false,
											locale,
											t,
										})
									})}
								</div>
							</fieldset>
						)
					})}
					{(maxRows == null || rows.length < maxRows) && (
						<button
							id={addId}
							type="button"
							className={cn(
								'w-fit rounded-md border border-input px-3 py-1.5 text-sm shadow-sm',
								'hover:bg-accent hover:text-accent-foreground'
							)}
							onClick={addRow}
						>
							{addLabel}
						</button>
					)}
				</div>
				<div className="grid gap-1 text-sm">
					{description ? <p className="text-muted-foreground">{description}</p> : null}
					{invalid ? (
						<div aria-atomic className="text-destructive" role="alert">
							{errors.map((message) => (
								<p key={message}>{message}</p>
							))}
						</div>
					) : null}
					{warnings?.map((message) => (
						<p key={message} className="text-amber-600">
							{message}
						</p>
					))}
				</div>
			</div>
		)
	}
)
