'use client'

import { ReactSelect } from '@payloadcms/ui'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters } from '../types'
import type { EditorProps, SelectOption } from './types'

type Props = EditorProps & {
	collectionOptions: SelectOption[]
	globalOptions: SelectOption[]
	tenantGlobalOptions: SelectOption[]
}

/**
 * Collections and globals side by side: both answer "which part of the site". In
 * the tenant view the per-tenant singletons fill the Globals select; they are
 * collections underneath, so both selects write `collections`, each its own share.
 */
export function CollectionEditor({
	collectionOptions,
	globalOptions,
	setStaged,
	staged,
	tenantGlobalOptions,
}: Props) {
	const { t } = useTranslation()

	const field = (name: 'collections' | 'globals', label: string, options: SelectOption[]) => {
		const own = new Set(options.map((o) => o.value))
		const current = staged[name] ?? []
		return (
			<div className="al-ref-picker">
				<div className="al-filterpopover__editor-label">{label}</div>
				<ReactSelect
					isClearable
					isMulti
					onChange={(selected) => {
						const picked = (Array.isArray(selected) ? selected : selected ? [selected] : []).map(
							(o) => String(o.value)
						)
						setStaged((f): Filters => {
							// Keep what the other select owns in the same list.
							const next = [...(f[name] ?? []).filter((v) => !own.has(v)), ...picked]
							return { ...f, [name]: next.length ? next : undefined }
						})
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
			{tenantGlobalOptions.length > 0
				? field('collections', t(keys.filterGlobal), tenantGlobalOptions)
				: globalOptions.length > 0 && field('globals', t(keys.filterGlobal), globalOptions)}
		</div>
	)
}
