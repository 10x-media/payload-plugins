'use client'

import { ReactSelect } from '@payloadcms/ui'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters } from '../types'
import type { EditorProps, SelectOption } from './types'

type Props = EditorProps & {
	collectionOptions: SelectOption[]
	globalOptions: SelectOption[]
}

/** Collections and globals side by side: both answer "which part of the site". */
export function CollectionEditor({ collectionOptions, globalOptions, setStaged, staged }: Props) {
	const { t } = useTranslation()

	const field = (name: 'collections' | 'globals', label: string, options: SelectOption[]) => {
		const current = staged[name] ?? []
		return (
			<div className="al-ref-picker">
				<div className="al-filterpopover__editor-label">{label}</div>
				<ReactSelect
					isClearable
					isMulti
					onChange={(selected) => {
						const values = (Array.isArray(selected) ? selected : selected ? [selected] : []).map(
							(o) => String(o.value)
						)
						setStaged((f): Filters => ({ ...f, [name]: values.length ? values : undefined }))
					}}
					options={options}
					value={options.filter((o) => current.includes(o.value))}
				/>
			</div>
		)
	}

	return (
		<div className="al-panel-grid">
			{field('collections', t(keys.filterCollection), collectionOptions)}
			{globalOptions.length > 0 && field('globals', t(keys.filterGlobal), globalOptions)}
		</div>
	)
}
