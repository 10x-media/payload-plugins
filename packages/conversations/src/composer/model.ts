import type {
	ComposerFeature,
	ComposerSlashGroup,
	ComposerToolbarGroup,
	ComposerToolbarItem,
} from './types'

/** Stable sort by `order`; entries without one keep their place after those with one. */
const byOrder = <T extends { order?: number }>(entries: T[]): T[] =>
	entries
		.map((entry, index) => ({ entry, index }))
		.sort(
			(a, b) =>
				(a.entry.order ?? Number.POSITIVE_INFINITY) - (b.entry.order ?? Number.POSITIVE_INFINITY) ||
				a.index - b.index
		)
		.map(({ entry }) => entry)

/** Items merged by key: a later feature's item replaces an earlier one with the same key. */
const mergeItems = <T extends { key: string }>(current: T[], incoming: T[]): T[] => {
	const keys = new Set(incoming.map((item) => item.key))
	return [...current.filter((item) => !keys.has(item.key)), ...incoming]
}

/**
 * Every feature's toolbar groups as one ordered list: same-key groups merge
 * (the first sets the type, a later `order` or icon wins), groups and their
 * items sort by `order`.
 */
export const mergeToolbarGroups = (features: ComposerFeature[]): ComposerToolbarGroup[] => {
	const groups = new Map<string, ComposerToolbarGroup>()
	for (const feature of features) {
		for (const group of feature.toolbar?.groups ?? []) {
			const existing = groups.get(group.key)
			if (!existing) {
				groups.set(group.key, { ...group, items: [...group.items] })
				continue
			}
			groups.set(group.key, {
				...existing,
				...(group.order === undefined ? {} : { order: group.order }),
				...(group.type === 'dropdown' && existing.type === 'dropdown'
					? {
							ChildComponent: group.ChildComponent ?? existing.ChildComponent,
							label: group.label ?? existing.label,
						}
					: {}),
				items: mergeItems(existing.items, group.items),
			} as ComposerToolbarGroup)
		}
	}
	return byOrder([...groups.values()]).map((group) => ({ ...group, items: byOrder(group.items) }))
}

/** Every feature's `/` groups, same-key groups merged, in feature order. */
export const mergeSlashGroups = (features: ComposerFeature[]): ComposerSlashGroup[] => {
	const groups = new Map<string, ComposerSlashGroup>()
	for (const feature of features) {
		for (const group of feature.slashMenu?.groups ?? []) {
			const existing = groups.get(group.key)
			groups.set(
				group.key,
				existing
					? {
							...existing,
							items: mergeItems(existing.items, group.items),
							label: group.label ?? existing.label,
						}
					: { ...group, items: [...group.items] }
			)
		}
	}
	return [...groups.values()]
}

/**
 * Narrow and reorder the toolbar to `keys`: a group key keeps that whole group
 * (a dropdown stays a dropdown), an item key keeps that item as a button.
 * Consecutive picked items from one group stay together; each run of items
 * becomes its own buttons group, so dividers follow the list.
 */
export const pickToolbar = (
	groups: ComposerToolbarGroup[],
	keys: string[] | undefined
): ComposerToolbarGroup[] => {
	if (!keys) return groups
	const byGroup = new Map(groups.map((group) => [group.key, group]))
	const byItem = new Map<string, { group: string; item: ComposerToolbarItem }>()
	for (const group of groups) {
		for (const item of group.items) byItem.set(item.key, { group: group.key, item })
	}
	const picked: ComposerToolbarGroup[] = []
	for (const key of keys) {
		const group = byGroup.get(key)
		if (group) {
			picked.push(group)
			continue
		}
		const found = byItem.get(key)
		if (!found) continue
		const last = picked.at(-1)
		const runKey = `${found.group}:picked`
		if (last?.type === 'buttons' && last.key.startsWith(runKey)) {
			last.items.push(found.item)
		} else {
			picked.push({ items: [found.item], key: `${runKey}:${picked.length}`, type: 'buttons' })
		}
	}
	return picked
}
