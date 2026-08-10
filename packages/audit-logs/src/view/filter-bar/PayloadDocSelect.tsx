'use client'

import { ReactSelect, useConfig, useDebounce } from '@payloadcms/ui'
import { useCallback, useEffect, useState } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { SelectOption } from './types'

type Props = {
	collection: string
	onSelect: (id: string) => void
	titleField: string
}

export function PayloadDocSelect({ collection, onSelect, titleField }: Props) {
	const { t } = useTranslation()
	const {
		config: {
			routes: { api },
		},
	} = useConfig()

	const [options, setOptions] = useState<SelectOption[]>([])
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 300)
	const [hasLoadedAll, setHasLoadedAll] = useState(false)
	const [nextPage, setNextPage] = useState(1)

	// biome-ignore lint/correctness/useExhaustiveDependencies: ported as is; hasLoadedAll and nextPage are read from a stale closure, so scroll-to-bottom refetches page 1. Tracked as a port follow-up.
	const loadOptions = useCallback(
		async (reset: boolean) => {
			if (!reset && hasLoadedAll) return
			const page = reset ? 1 : nextPage

			try {
				const qs = new URLSearchParams({ depth: '0', limit: '10', page: String(page) })
				if (debouncedSearch) {
					qs.append('where[or][0][id][like]', debouncedSearch)
					if (titleField !== 'id') qs.append(`where[or][1][${titleField}][like]`, debouncedSearch)
				}
				const res = await fetch(`${api}/${collection}?${qs.toString()}`, { credentials: 'include' })
				if (!res.ok) return
				const data = (await res.json()) as { docs: Record<string, unknown>[]; nextPage?: number }
				const newOptions = data.docs.map((d) => ({
					label: String(d[titleField] ?? d.id),
					value: String(d.id),
				}))
				setOptions((prev) => (reset ? newOptions : [...prev, ...newOptions]))
				setHasLoadedAll(!data.nextPage)
				setNextPage(data.nextPage ?? 1)
			} catch {
				// silently ignore
			}
		},
		[api, collection, debouncedSearch, titleField]
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: resetting on a new search must not re-run when the callback identity changes
	useEffect(() => {
		setHasLoadedAll(false)
		setNextPage(1)
		setOptions([])
		void loadOptions(true)
	}, [debouncedSearch, collection])

	return (
		<ReactSelect
			onChange={(selected) => {
				const opt = selected as SelectOption | null
				if (opt) onSelect(opt.value)
			}}
			onInputChange={(input) => setSearch(input)}
			onMenuScrollToBottom={() => void loadOptions(false)}
			options={options}
			placeholder={t(keys.searchPlaceholder)}
		/>
	)
}
