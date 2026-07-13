'use client'

import {
	FieldLabel,
	ReactSelect,
	type ReactSelectOption,
	useField,
	useFormFields,
} from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import { useMemo } from 'react'
import { fieldNamesOfType } from '../fields/fieldNamesOfType'
import type { FieldRow } from './synthesizeClientField'
import { toStaticLabel } from './toStaticLabel'

/** Props: standard JSON/text field client props plus the `types` allow-list we pass via clientProps. */
export type FieldNameSelectProps = {
	path?: string
	field?: { label?: unknown }
	label?: unknown
	/** Sibling `fields` blocks whose `blockType` is in this list populate the select's options. */
	types: string[]
}

const optionsFromData = (data: Record<string, unknown>, types: string[]): ReactSelectOption[] => {
	const rows = Array.isArray(data.fields) ? (data.fields as unknown[]) : []
	const labels = new Map<string, string>()
	for (const row of rows) {
		if (!row || typeof row !== 'object') {
			continue
		}
		const { name, label } = row as FieldRow
		if (typeof name === 'string' && typeof label === 'string' && label.length > 0) {
			labels.set(name.trim(), label)
		}
	}
	return fieldNamesOfType(data.fields, types).map((name) => ({
		label: labels.get(name) ?? name,
		value: name,
	}))
}

/**
 * The `Field` mounted on a text config field (e.g. an action's `toField`) that should be authored
 * by picking from the form's own fields rather than free-typing a name. Options come from the
 * sibling `fields` blocks array, filtered to `types`; the stored value is kept selectable even if
 * it no longer matches any field, so switching to this component never silently drops data.
 */
export const FieldNameSelect = (props: FieldNameSelectProps) => {
	const { path, setValue, value } = useField<string>({ path: props.path })
	const label = toStaticLabel(props.field?.label ?? props.label)

	const optionsJson = useFormFields(([fields]) =>
		JSON.stringify(optionsFromData(reduceFieldsToValues(fields, true), props.types))
	)
	const options = useMemo(() => JSON.parse(optionsJson) as ReactSelectOption[], [optionsJson])

	const allOptions =
		value && !options.some((option) => option.value === value)
			? [...options, { label: value, value }]
			: options

	const handleChange = (selected: ReactSelectOption | ReactSelectOption[] | null) => {
		const chosen = Array.isArray(selected) ? selected[0] : selected
		setValue(chosen ? (chosen.value as string) : '')
	}

	return (
		<div className="field-type" style={{ marginBlockEnd: '1rem' }}>
			<FieldLabel label={label} path={path} />
			<ReactSelect
				options={allOptions}
				value={allOptions.find((option) => option.value === value) ?? undefined}
				isClearable
				onChange={handleChange}
			/>
		</div>
	)
}
