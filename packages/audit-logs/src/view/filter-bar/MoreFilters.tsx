'use client'

import { useConfig } from '@payloadcms/ui'
import { useMemo } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { fieldPaths } from '../fieldPaths'
import type { Filters, SelectOption } from '../types'
import { labelOf } from '../utils'
import { RefPicker, ValuesInput } from './RefPicker'
import type { EditorProps } from './types'

type Props = EditorProps & {
	apiOptions: SelectOption[]
	documentCollections: string[]
	labels: Record<string, string>
	onLabel: (ref: string, label: string) => void
	titleFields: Record<string, string>
}

/** The rare filters, all on one screen, each taking several values. */
export function MoreFilters({
	apiOptions,
	documentCollections,
	labels,
	onLabel,
	setStaged,
	staged,
	titleFields,
}: Props) {
	const { i18n, t } = useTranslation()
	const { getEntityConfig } = useConfig()

	// Only once a collection or global is picked: across the whole site the list
	// would be long and mostly noise.
	const scopeKey = [...(staged.collections ?? []), '|', ...(staged.globals ?? [])].join(',')
	// One group per collection or global, named from its config; the paths stay raw.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined key stands in for both arrays
	const pathOptions = useMemo(() => {
		const groups = [
			...(staged.collections ?? []).map((slug) => {
				const config = getEntityConfig({ collectionSlug: slug })
				return { config, label: labelOf(config?.labels?.plural, i18n) ?? slug }
			}),
			...(staged.globals ?? []).map((slug) => {
				const config = getEntityConfig({ globalSlug: slug })
				return { config, label: labelOf(config?.label, i18n) ?? slug }
			}),
		]
		return groups.flatMap(({ config, label }) =>
			config
				? [
						{
							label,
							options: fieldPaths(config.fields).map(
								(path): SelectOption => ({ label: path, value: path })
							),
						},
					]
				: []
		)
	}, [scopeKey, getEntityConfig, i18n])

	const set = (field: 'apis' | 'changedPaths' | 'documents' | 'groups') => (values?: string[]) =>
		setStaged((f): Filters => ({ ...f, [field]: values }))

	return (
		<div className="al-panel-grid">
			<RefPicker
				collections={documentCollections}
				label={t(keys.filterDocument)}
				labels={labels}
				onChange={set('documents')}
				onLabel={onLabel}
				refs={staged.documents ?? []}
				titleFields={titleFields}
			/>
			<ValuesInput
				label={t(keys.filterChangedPath)}
				onChange={set('changedPaths')}
				options={pathOptions}
				placeholder={t(keys.fieldPathPlaceholder)}
				values={staged.changedPaths ?? []}
			/>
			<ValuesInput
				label={t(keys.filterGroup)}
				onChange={set('groups')}
				placeholder={t(keys.groupPlaceholder)}
				values={staged.groups ?? []}
			/>
			{/* Labels from `logs.payloadAPIs`; any other value a plugin sets can be typed. */}
			<ValuesInput
				label={t(keys.filterApi)}
				onChange={set('apis')}
				options={apiOptions}
				placeholder={t(keys.apiPlaceholder)}
				values={staged.apis ?? []}
			/>
		</div>
	)
}
