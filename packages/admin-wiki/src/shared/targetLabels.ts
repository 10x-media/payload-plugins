/**
 * Human labels for target keys, used by the chips that tell a reader which
 * surfaces a guide covers. Server-safe and client-safe: the entity shape it
 * needs is the intersection of the full and the client config.
 */

import type { WikiTargetType } from './targetKeys'

/** The slice of a collection or global config a label can be read from. */
export type LabelledEntity = {
	label?: unknown
	labels?: unknown
	slug: string
}

export type EntityLabelSources = {
	collections?: LabelledEntity[]
	globals?: LabelledEntity[]
}

/** A target key parsed into its kind and the value after the colon. */
export type ParsedTargetKey = {
	kind: WikiTargetType
	value: string
}

export type DescribedTarget = ParsedTargetKey & {
	/** Human label: the entity's own label where one exists, else the raw value. */
	label: string
}

const KINDS: Record<string, WikiTargetType> = {
	block: 'block',
	collection: 'collection',
	field: 'field',
	global: 'global',
}

/** Split `collection:posts` into its kind and value; null when unparseable. */
export const parseTargetKey = (key: string): null | ParsedTargetKey => {
	const separator = key.indexOf(':')
	if (separator < 1) {
		return null
	}
	const kind = KINDS[key.slice(0, separator)]
	const value = key.slice(separator + 1)
	return kind && value ? { kind, value } : null
}

const singularLabel = (entity: LabelledEntity): string => {
	const labels = entity.labels as { singular?: unknown } | undefined
	if (typeof labels?.singular === 'string') {
		return labels.singular
	}
	if (typeof entity.label === 'string') {
		return entity.label
	}
	return entity.slug
}

const findLabel = (entities: LabelledEntity[] | undefined, slug: string): null | string => {
	const entity = entities?.find((candidate) => candidate.slug === slug)
	return entity ? singularLabel(entity) : null
}

/**
 * Describe one target key for display. Collections and globals resolve to their
 * configured labels; field paths and block slugs have no label in the config, so
 * they show their own value, which is what an author typed and recognizes.
 */
export const describeTarget = (
	key: string,
	sources: EntityLabelSources
): null | DescribedTarget => {
	const parsed = parseTargetKey(key)
	if (!parsed) {
		return null
	}
	switch (parsed.kind) {
		case 'collection':
			return { ...parsed, label: findLabel(sources.collections, parsed.value) ?? parsed.value }
		case 'global':
			return { ...parsed, label: findLabel(sources.globals, parsed.value) ?? parsed.value }
		default:
			return { ...parsed, label: parsed.value }
	}
}

/** Describe a guide's stored target keys, dropping any that no longer parse. */
export const describeTargets = (keys: string[], sources: EntityLabelSources): DescribedTarget[] =>
	keys.flatMap((key) => {
		const described = describeTarget(key, sources)
		return described ? [described] : []
	})
