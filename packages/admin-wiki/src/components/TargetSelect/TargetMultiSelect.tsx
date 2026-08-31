'use client'

import { type ReactSelectOption, SelectInput, useField } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientProps } from 'payload'
import { useCallback } from 'react'

export type TargetMultiSelectProps = {
	/** The pickable targets, labelled in the reader's language by the caller. */
	options: OptionObject[]
} & TextFieldClientProps

/**
 * The shared body of the target lists that are a plain multi-select.
 *
 * The stored field stays `text` with `hasMany`, so values remain raw keys and a
 * target whose surface has since left the config is still readable, still listed
 * by the orphan banner, and still removable here. `SelectInput` renders such a
 * value under its own key, since no option matches it.
 */
export const TargetMultiSelect = ({
	field,
	options,
	path: pathFromProps,
	readOnly,
}: TargetMultiSelectProps) => {
	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[]>({ potentiallyStalePath: pathFromProps })

	const onChange = useCallback(
		(selected: ReactSelectOption | ReactSelectOption[]) => {
			if (readOnly || disabled) {
				return
			}
			setValue(Array.isArray(selected) ? selected.map((option) => String(option.value)) : [])
		},
		[disabled, readOnly, setValue]
	)

	return (
		<SelectInput
			Description={Description}
			description={field?.admin?.description}
			Error={ErrorComponent}
			hasMany
			isSortable={false}
			Label={Label}
			label={field?.label}
			name={field.name}
			onChange={onChange}
			options={options}
			path={path}
			readOnly={readOnly || disabled}
			showError={showError}
			value={value ?? []}
		/>
	)
}
