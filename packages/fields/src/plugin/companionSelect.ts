import type { CollectionConfig, Field } from 'payload'

/** `field.custom` key under which a field lists the companions its list Cell reads. */
const FIELD_CUSTOM_KEY = '@10x-media/fields'

/** One selectable field and the sibling names that must be selected with it. */
export type CompanionEntry = { path: string; siblings: string[] }

/** Dot path of a sibling of `path` named `name`. */
export const siblingPath = (path: string, name: string): string =>
	path.includes('.') ? `${path.slice(0, path.lastIndexOf('.') + 1)}${name}` : name

/**
 * Marks `field` so that selecting it also selects the named siblings. A list Cell that reads a
 * virtual sibling from `rowData` needs this: Payload 4's list view selects only visible columns.
 */
export const withCompanions = <TField extends Field>(field: TField, siblings: string[]): TField => {
	const custom = (field.custom ?? {}) as Record<string, unknown>
	const own = (custom[FIELD_CUSTOM_KEY] ?? {}) as Record<string, unknown>
	return {
		...field,
		custom: { ...custom, [FIELD_CUSTOM_KEY]: { ...own, selectWith: siblings } },
	}
}

const companionsOf = (field: Field): string[] => {
	const own = (field.custom as Record<string, unknown> | undefined)?.[FIELD_CUSTOM_KEY] as
		| { selectWith?: unknown }
		| undefined
	return Array.isArray(own?.selectWith)
		? own.selectWith.filter((name): name is string => typeof name === 'string')
		: []
}

/** Companion entries by dot path through groups, named tabs, rows, collapsibles and unnamed tabs. */
export const scanCompanions = (fields: Field[] | undefined, prefix = ''): CompanionEntry[] => {
	const out: CompanionEntry[] = []
	for (const field of fields ?? []) {
		if ('name' in field && typeof field.name === 'string') {
			const siblings = companionsOf(field)
			if (siblings.length > 0) {
				const path = `${prefix}${field.name}`
				out.push({ path, siblings: siblings.map((name) => siblingPath(path, name)) })
			}
		}
		if (field.type === 'group' && 'name' in field && field.name) {
			out.push(...scanCompanions(field.fields, `${prefix}${field.name}.`))
		} else if (field.type === 'row' || field.type === 'collapsible') {
			out.push(...scanCompanions(field.fields, prefix))
		} else if (field.type === 'tabs') {
			for (const tab of field.tabs) {
				const tabPrefix = 'name' in tab && tab.name ? `${prefix}${tab.name}.` : prefix
				out.push(...scanCompanions(tab.fields, tabPrefix))
			}
		}
	}
	return out
}

type SelectNode = { [key: string]: SelectNode | boolean }

type SelectFunction = (
	args: Parameters<NonNullable<CollectionConfig['select']>>[0]
) => Parameters<NonNullable<CollectionConfig['select']>>[0]['select']

const selectedAt = (select: SelectNode, path: string): boolean => {
	let node: SelectNode | boolean | undefined = select
	for (const segment of path.split('.')) {
		if (!node || typeof node !== 'object') return false
		node = node[segment]
	}
	return node === true || (typeof node === 'object' && node !== null)
}

const withSelectedAt = (select: SelectNode, path: string): SelectNode => {
	const [head, ...rest] = path.split('.') as [string, ...string[]]
	if (rest.length === 0) return { ...select, [head]: true }
	const child = select[head]
	if (child === true) return select
	return {
		...select,
		[head]: withSelectedAt(typeof child === 'object' ? child : {}, rest.join('.')),
	}
}

/**
 * A collection `select` function that adds each entry's siblings to an include-mode select that
 * names the entry's field, after running the collection's own `select` function. An exclude-mode
 * select already returns the siblings unless it excludes them by name, so it passes through.
 */
export const companionSelect = (
	entries: CompanionEntry[],
	prior: CollectionConfig['select']
): NonNullable<CollectionConfig['select']> => {
	const selectFn: SelectFunction = (args) => {
		const resolved = prior ? prior(args) : undefined
		const select = (resolved === undefined ? args.select : resolved) as SelectNode | undefined
		if (!select || Object.values(select).some((value) => value === false)) return resolved
		let next = select
		for (const { path, siblings } of entries) {
			if (!selectedAt(next, path)) continue
			for (const sibling of siblings) next = withSelectedAt(next, sibling)
		}
		return next === select ? resolved : (next as typeof args.select)
	}
	// A collection typed against generated types narrows the return to its include shape;
	// adding sibling keys keeps an include select an include select.
	return selectFn as NonNullable<CollectionConfig['select']>
}

/**
 * Selects the companions marked with `withCompanions` whenever their field is selected. The
 * fields() plugin applies this to every collection; call it directly only when using the field
 * factories without the plugin.
 */
export const withCompanionSelect = (collection: CollectionConfig): CollectionConfig => {
	const entries = scanCompanions(collection.fields)
	if (entries.length === 0) return collection
	return { ...collection, select: companionSelect(entries, collection.select) }
}
