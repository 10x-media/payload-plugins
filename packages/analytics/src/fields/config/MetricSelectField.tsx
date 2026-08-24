'use client'

import {
	type ReactSelectOption,
	SelectInput,
	useConfig,
	useField,
	useFormFields,
} from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'
import { useEffect, useMemo, useState } from 'react'
import type { CapabilityRequirement } from '../../core/capabilities'
import { useTranslation } from '../../translations/useTranslation'
import { fetchSources, type WireSource } from './fetchSources'
import { narrowMetricOptions } from './narrow'
import { toSelectOption } from './toSelectOption'

export type MetricSelectFieldProps = SelectFieldClientProps & {
	/** Extra capability requirement (beyond the picked metric) a widget's other config imposes, e.g. a breakdown dimension. */
	requires?: Omit<CapabilityRequirement, 'metrics'>
}

/**
 * Metric picker for scoped widget config: narrows the static option list to
 * what the sibling `dataSource` field's source can actually serve, once the
 * sources endpoint answers. Never clears an already-picked value that
 * narrowing filters out; the read path degrades that case on its own.
 */
export const MetricSelectField = (props: MetricSelectFieldProps) => {
	const { field, path, readOnly, requires } = props
	const { i18n } = useTranslation()
	const locale = i18n.language
	const { setValue, value } = useField<string>({ path })
	const {
		config: {
			routes: { api },
			serverURL,
		},
	} = useConfig()
	const sourceId = useFormFields(([fields]) => fields?.dataSource?.value as string | undefined)

	const staticOptions = useMemo(
		() => field.options.map((option) => toSelectOption(option, locale)),
		[field.options, locale]
	)
	const [sources, setSources] = useState<WireSource[]>([])

	useEffect(() => {
		let cancelled = false
		fetchSources(serverURL ?? '', api)
			.then((fetched) => {
				if (!cancelled) setSources(fetched)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api, serverURL])

	const options = narrowMetricOptions({ options: staticOptions, requires, sourceId, sources }).map(
		(option) => ({ label: option.label as string, value: option.value })
	)

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
			value={value}
		/>
	)
}
