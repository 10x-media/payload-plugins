'use client'

import { useField } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import type { CapabilityRequirement } from '../../core/capabilities'
import { narrowMetricOptions } from './narrow'
import { OptionSelect, useStaticOptions } from './OptionSelect'
import { useAnalyticsSources } from './useAnalyticsSources'
import { useFormString } from './useFormString'

/** @beta */
export type MetricSelectFieldProps = SelectFieldClientProps & {
	/** What else the widget's other config requires of a source, e.g. a breakdown dimension. */
	requires?: Omit<CapabilityRequirement, 'metrics'>
	/**
	 * Path of the sibling source select this picker narrows against, for custom widgets
	 * whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
}

/**
 * Narrows options to what the sibling source can serve and `filterOptions` allow, but never
 * clears a picked value that narrowing filters out; the read path degrades that case itself.
 *
 * @beta
 */
export const MetricSelectField = (props: MetricSelectFieldProps) => {
	const { field, path: pathFromProps, readOnly, requires, sourceFieldPath = 'dataSource' } = props
	const fieldState = useField<string>({ potentiallyStalePath: pathFromProps })
	const { sources } = useAnalyticsSources()
	const sourceId = useFormString(sourceFieldPath)
	const staticOptions = useStaticOptions(field.options)

	const options = narrowMetricOptions({
		options: staticOptions,
		requires,
		sourceId,
		sources: sources ?? [],
	})
	// Server `filterOptions` arrive as `selectFilterOptions`, applied as Payload's own select does:
	// hidden from the menu, stored value still named.
	const { selectFilterOptions } = fieldState
	const offered =
		selectFilterOptions === undefined
			? undefined
			: new Set(
					selectFilterOptions.map((option) => (typeof option === 'string' ? option : option.value))
				)

	return (
		<OptionSelect
			field={field}
			fieldState={fieldState}
			filterOption={
				offered === undefined
					? undefined
					: ({ label, value }, search) =>
							offered.has(value) && label.toLowerCase().includes(search.toLowerCase())
			}
			options={options}
			readOnly={readOnly}
		/>
	)
}
