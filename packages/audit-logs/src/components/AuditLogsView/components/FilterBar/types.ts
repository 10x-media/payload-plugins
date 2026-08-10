import type { Filters, SelectOption } from '../../types'

export type { SelectOption }

export type FilterField =
	| 'collections'
	| 'globals'
	| 'operations'
	| 'tenant'
	| 'userId'
	| 'documentId'
	| 'eventType'
	| 'changedPath'
	| 'group'
	| 'dateRange'

export type AvailableFilter = { key: FilterField; label: string }

export type FilterBarProps = {
	collectionSlugs: string[]
	filters: Filters
	globalSlugs: string[]
	onFilter: (f: Filters) => void
	tenantOptions?: SelectOption[]
	userTitleFields: Record<string, string>
}

export type EditorProps = {
	onClose: () => void
	setStaged: React.Dispatch<React.SetStateAction<Filters>>
	staged: Filters
}
