import type { Filters, SelectOption } from '../types'

export type { SelectOption }

export type FilterBarProps = {
	/** Every collection but the log itself, labelled from its config. */
	collectionOptions: SelectOption[]
	/** Custom event types offered under Event. */
	customEventTypes: SelectOption[]
	/** Label per event type, auth and custom, for the Event pill and its list. */
	eventTypeLabels: Record<string, string>
	filters: Filters
	globalOptions: SelectOption[]
	/** Per-tenant singleton collections, offered as globals in the tenant view. */
	tenantGlobalOptions: SelectOption[]
	onFilter: (f: Filters) => void
	/** `payloadAPI` value to label: the built-ins plus `logs.payloadAPIs`. */
	payloadAPILabels: Record<string, string>
	/** Titles of the documents and users the current filters name. */
	refLabels: Record<string, string>
	tenantOptions?: SelectOption[]
	/** `useAsTitle` per collection, to name what the drawers pick. */
	titleFields: Record<string, string>
	/** Auth collections, offered by the user picker. */
	userCollections: string[]
}

export type EditorProps = {
	setStaged: React.Dispatch<React.SetStateAction<Filters>>
	staged: Filters
}
