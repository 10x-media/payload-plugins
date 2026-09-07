import type { Config, SanitizedConfig } from 'payload'

import type { LocalizedLabel, SettingsOverlayItem } from '../types'

export type EntityLabels = {
	/** `false` means Payload's "never group this", which the rail honours. */
	group?: LocalizedLabel | false
	label: LocalizedLabel
}

export type EntityLookup = {
	collection: (slug: string) => EntityLabels | undefined
	global: (slug: string) => EntityLabels | undefined
}

const asLabel = (value: unknown, fallback: string): LocalizedLabel =>
	typeof value === 'string' || (value && typeof value === 'object')
		? (value as LocalizedLabel)
		: fallback

const asGroup = (value: unknown): EntityLabels['group'] => {
	if (value === false) {
		return false
	}
	if (typeof value === 'string' || (value && typeof value === 'object')) {
		return value as LocalizedLabel
	}
	return undefined
}

/**
 * Labels and groups as declared on the config.
 *
 * A collection's `labels.plural` may be a string, a record, or a function; a function resolves
 * to the slug, because a rail label is computed without the request a label function expects.
 */
export const lookupFromConfig = (config: Config | SanitizedConfig): EntityLookup => ({
	collection: (slug) => {
		const found = (config.collections ?? []).find((collection) => collection.slug === slug)
		if (!found) {
			return undefined
		}
		return { group: asGroup(found.admin?.group), label: asLabel(found.labels?.plural, slug) }
	},
	global: (slug) => {
		const found = (config.globals ?? []).find((global) => global.slug === slug)
		if (!found) {
			return undefined
		}
		return { group: asGroup(found.admin?.group), label: asLabel(found.label, slug) }
	},
})

const entityFor = (item: SettingsOverlayItem, entities: EntityLookup): EntityLabels | undefined => {
	if (item.type === 'collection') {
		return entities.collection(item.slug)
	}
	if (item.type === 'global') {
		return entities.global(item.slug)
	}
	return undefined
}

export const resolveItemLabel = (
	item: SettingsOverlayItem,
	entities: EntityLookup
): LocalizedLabel => item.label ?? entityFor(item, entities)?.label ?? item.slug

export const resolveItemGroup = (
	item: SettingsOverlayItem,
	entities: EntityLookup
): LocalizedLabel | undefined => {
	if (item.group) {
		return item.group
	}
	const group = entityFor(item, entities)?.group
	return group === false || group === undefined ? undefined : group
}
