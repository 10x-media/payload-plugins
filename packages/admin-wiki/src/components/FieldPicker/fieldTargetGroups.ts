/**
 * Grouping and editing helpers for the stored `targetFields` list. Pure, so the
 * ordering and ownership rules the authoring UI depends on are testable without
 * a form around them.
 */

import {
	type EntityLabelSources,
	type FieldTargetRoot,
	fieldOwnerLabel,
	parseFieldTarget,
} from '../../shared/targetLabels'

/** One stored target, as a group renders it. */
export type WikiFieldTargetItem = {
	/**
	 * What the row shows: the path inside its owner, or the whole stored value
	 * when there is no owner to strip.
	 */
	label: string
	/** The stored value, which is what removal and selection key on. */
	value: string
}

export type WikiFieldTargetGroup = {
	/** Stable key: the owner prefix, or `unresolved` for the catch-all. */
	id: string
	/**
	 * `unresolved` collects targets whose owner is missing from the config or
	 * whose value carries no owner at all. Its heading is supplied by the caller,
	 * since it is translated rather than read off a config.
	 */
	kind: 'unresolved' | FieldTargetRoot
	/** The owner's configured label; empty on the unresolved group. */
	label: string
	/** The owner's slug; empty on the unresolved group. */
	slug: string
	targets: WikiFieldTargetItem[]
}

/** The slugs the plugin covers, per kind, as injected into the authoring UI. */
export type WikiCoveredSlugs = {
	blocks: string[]
	collections: string[]
	globals: string[]
}

const UNRESOLVED = 'unresolved'

/** Collections first, then globals, then blocks: broadest surface to narrowest. */
const KIND_ORDER: Record<WikiFieldTargetGroup['kind'], number> = {
	collection: 0,
	global: 1,
	block: 2,
	unresolved: 3,
}

const coveredFor = (kind: FieldTargetRoot, covered: WikiCoveredSlugs): string[] => {
	switch (kind) {
		case 'block':
			return covered.blocks
		case 'collection':
			return covered.collections
		case 'global':
			return covered.globals
	}
}

/**
 * Group stored field targets by what they are rooted at.
 *
 * A guide that documents a whole form carries dozens of these, and a flat list
 * of `collection:posts.branding.color` strings says nothing a reader can scan.
 * Grouped by owner, the same list answers "what does this guide cover" at a
 * glance: three fields on Post, eight on Settings, two inside the Hero banner
 * block.
 *
 * Targets whose owner is not in the covered slugs land in the unresolved group
 * under their raw value, rather than under a plausible-looking label for
 * something that is not in the config. That is the same rule the orphan banner
 * applies, and it keeps a stale target visible and removable instead of hiding
 * it among the live ones.
 */
export const groupFieldTargets = (
	values: string[] | undefined,
	sources: EntityLabelSources,
	covered: WikiCoveredSlugs
): WikiFieldTargetGroup[] => {
	const groups = new Map<string, WikiFieldTargetGroup>()

	const groupFor = (id: string, seed: () => Omit<WikiFieldTargetGroup, 'targets'>) => {
		const existing = groups.get(id)
		if (existing) {
			return existing
		}
		const created: WikiFieldTargetGroup = { ...seed(), targets: [] }
		groups.set(id, created)
		return created
	}

	for (const value of values ?? []) {
		if (typeof value !== 'string' || value.length === 0) {
			continue
		}
		const parsed = parseFieldTarget(value)
		if (!parsed || !coveredFor(parsed.ownerType, covered).includes(parsed.ownerSlug)) {
			groupFor(UNRESOLVED, () => ({
				id: UNRESOLVED,
				kind: UNRESOLVED,
				label: '',
				slug: '',
			})).targets.push({ label: value, value })
			continue
		}
		const id = `${parsed.ownerType}:${parsed.ownerSlug}`
		groupFor(id, () => ({
			id,
			kind: parsed.ownerType,
			label: fieldOwnerLabel(parsed, sources),
			slug: parsed.ownerSlug,
		})).targets.push({ label: parsed.path, value })
	}

	return [...groups.values()].sort(
		(a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label)
	)
}

/** Append a target unless it is already stored; order is otherwise preserved. */
export const addFieldTarget = (values: string[] | undefined, value: string): string[] => {
	const current = values ?? []
	return current.includes(value) ? current : [...current, value]
}

/** Add or remove one target, keeping the stored order of everything else. */
export const toggleFieldTarget = (values: string[] | undefined, value: string): string[] => {
	const current = values ?? []
	return current.includes(value)
		? current.filter((candidate) => candidate !== value)
		: [...current, value]
}
