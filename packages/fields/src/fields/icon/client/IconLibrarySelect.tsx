'use client'

import { fieldBaseClass, SelectInput, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type React from 'react'
import { useCallback } from 'react'

export type IconLibrarySelectProps = TextFieldClientProps & {
	options: { label: string; value: string }[]
}

export const IconLibrarySelect: React.FC<IconLibrarySelectProps> = (props) => {
	const { field, options, path: pathFromProps, readOnly } = props
	const hasMany = 'hasMany' in field && field.hasMany === true
	const { disabled, path, setValue, showError, value } = useField<string | string[]>({
		potentiallyStalePath: pathFromProps,
	})

	const handleChange = useCallback(
		(option: unknown) => {
			if (Array.isArray(option)) {
				setValue(option.map((entry) => (entry as { value: string }).value))
			} else if (option && typeof option === 'object' && 'value' in option) {
				setValue((option as { value: string }).value)
			} else {
				setValue(hasMany ? [] : null)
			}
		},
		[hasMany, setValue]
	)

	return (
		<div className={[fieldBaseClass, 'tenx-icon-library-field'].filter(Boolean).join(' ')}>
			<SelectInput
				hasMany={hasMany}
				isClearable={!field.required}
				label={field.label}
				localized={field.localized}
				name={field.name}
				onChange={handleChange}
				options={options}
				path={path}
				readOnly={Boolean(readOnly || disabled || field.admin?.readOnly)}
				required={field.required}
				showError={showError}
				value={value}
			/>
		</div>
	)
}
