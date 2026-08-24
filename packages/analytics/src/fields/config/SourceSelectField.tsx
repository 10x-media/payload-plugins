'use client'

import { type ReactSelectOption, SelectInput, useField } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { useTranslation } from '../../translations/useTranslation'
import { toSelectOption } from './toSelectOption'
import { useAnalyticsSources } from './useAnalyticsSources'

/**
 * Source picker for scoped widget config: starts from the field's static
 * option list and, once the caller-scope sources endpoint answers, replaces
 * it with the live adapter list so a tenant only ever sees sources it can
 * actually read from. A failed fetch keeps the static list rather than
 * emptying the picker.
 */
export const SourceSelectField = (props: SelectFieldClientProps) => {
	const { field, path, readOnly } = props
	const { i18n } = useTranslation()
	const locale = i18n.language
	const { setValue, showError, value } = useField<string>({ path })
	const { sources } = useAnalyticsSources()

	const staticOptions = useMemo(
		() => field.options.map((option) => toSelectOption(option, locale)),
		[field.options, locale]
	)

	const options =
		sources && sources.length > 0
			? sources.map((source) => ({ value: source.id, label: source.label }))
			: staticOptions

	return (
		<SelectInput
			isClearable={false}
			label={field.label}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option ? String(option.value) : null)
			}}
			options={options}
			path={path}
			readOnly={readOnly}
			required={field.required}
			showError={showError}
			value={value}
		/>
	)
}
