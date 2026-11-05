'use client'

import { type FieldType, type ReactSelectOption, SelectInput } from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { Option, SelectFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { useTranslation } from '../../translations/useTranslation'
import { toSelectOption } from './toSelectOption'

interface PlainOption {
	label: string
	value: string
}

/** The field's own options, their per-language labels read in the reader's language. */
export const useStaticOptions = (options: Option[]): PlainOption[] => {
	const { i18n } = useTranslation()
	const locale = i18n.language
	return useMemo(
		() => options.map((option) => toSelectOption(option, locale, i18n.fallbackLanguage)),
		[options, locale, i18n.fallbackLanguage]
	)
}

interface OptionSelectProps {
	field: SelectFieldClientProps['field']
	fieldState: FieldType<string>
	readOnly: boolean | undefined
	options: PlainOption[]
	/** Hides options from the menu while a stored one stays named. */
	filterOption?: ((option: PlainOption, search: string) => boolean) | undefined
}

/** Payload's select for a widget's source or metric, which always has one picked. */
export function OptionSelect(props: OptionSelectProps) {
	const { field, fieldState, filterOption } = props
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = fieldState
	const style = useMemo(() => mergeFieldStyles(field), [field])
	return (
		<SelectInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={field.admin?.className}
			Description={Description}
			description={field.admin?.description}
			Error={ErrorComponent}
			{...(filterOption === undefined ? {} : { filterOption })}
			isClearable={false}
			Label={Label}
			label={field.label}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option ? String(option.value) : null)
			}}
			options={props.options}
			path={path}
			readOnly={props.readOnly || disabled || field.admin?.readOnly}
			required={field.required}
			showError={showError}
			style={style}
			value={value}
		/>
	)
}
