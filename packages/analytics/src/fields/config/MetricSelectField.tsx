'use client'

import { type ReactSelectOption, SelectInput, useField, useFormFields } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import { useMemo } from 'react'
import type { CapabilityRequirement } from '../../core/capabilities'
import { useTranslation } from '../../translations/useTranslation'
import { narrowMetricOptions } from './narrow'
import { toSelectOption } from './toSelectOption'
import { useAnalyticsSources } from './useAnalyticsSources'

export type MetricSelectFieldProps = SelectFieldClientProps & {
	/** Extra capability requirement (beyond the picked metric) a widget's other config imposes, e.g. a breakdown dimension. */
	requires?: Omit<CapabilityRequirement, 'metrics'>
	/**
	 * Path of the sibling source select this picker narrows against, for
	 * custom widgets whose source field is named differently. Defaults to
	 * `'dataSource'`.
	 */
	sourceFieldPath?: string
}

/**
 * Metric picker for scoped widget config: narrows the static option list to
 * what the sibling source field's selected source can actually serve, once
 * the sources endpoint answers. Never clears an already-picked value that
 * narrowing filters out; the read path degrades that case on its own.
 */
export const MetricSelectField = (props: MetricSelectFieldProps) => {
	const { field, path, readOnly, requires, sourceFieldPath = 'dataSource' } = props
	const { i18n } = useTranslation()
	const locale = i18n.language
	const { setValue, showError, value } = useField<string>({ path })
	const { sources } = useAnalyticsSources()
	const sourceId = useFormFields(
		([fields]) => fields?.[sourceFieldPath]?.value as string | undefined
	)

	const staticOptions = useMemo(
		() => field.options.map((option) => toSelectOption(option, locale)),
		[field.options, locale]
	)

	const options = narrowMetricOptions({
		options: staticOptions,
		requires,
		sourceId,
		sources: sources ?? [],
	}).map((option) => ({ label: option.label as string, value: option.value }))

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
