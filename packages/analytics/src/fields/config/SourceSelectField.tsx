'use client'

import { useField } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import { OptionSelect, useStaticOptions } from './OptionSelect'
import { useAnalyticsSources } from './useAnalyticsSources'

/**
 * Swaps static options for the caller-scope source list once it answers, so a tenant sees only
 * sources it can read; a failed fetch keeps the static list rather than emptying the picker.
 *
 * @beta
 */
export const SourceSelectField = (props: SelectFieldClientProps) => {
	const { field, path: pathFromProps, readOnly } = props
	const fieldState = useField<string>({ potentiallyStalePath: pathFromProps })
	const { sources } = useAnalyticsSources()
	const staticOptions = useStaticOptions(field.options)

	const options =
		sources && sources.length > 0
			? sources.map((source) => ({ value: source.id, label: source.label }))
			: staticOptions

	return (
		<OptionSelect field={field} fieldState={fieldState} options={options} readOnly={readOnly} />
	)
}
