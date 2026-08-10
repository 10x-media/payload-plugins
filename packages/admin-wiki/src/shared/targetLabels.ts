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
	/** Singular label per block slug, collected by the config walker. */
	blockLabels?: Record<string, string>
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
 * Split a stored field target (`collection:posts.branding.color`) into the
 * entity that owns it and the path inside that entity. Null when the value
 * carries no entity prefix, in which case it is shown verbatim.
 */
const parseFieldTarget = (
	value: string
): null | { entitySlug: string; entityType: 'collection' | 'global'; path: string } => {
	const separator = value.indexOf(':')
	const entityType = value.slice(0, separator)
	if (separator < 1 || (entityType !== 'collection' && entityType !== 'global')) {
		return null
	}
	const rest = value.slice(separator + 1)
	const dot = rest.indexOf('.')
	if (dot < 1) {
		return null
	}
	return { entitySlug: rest.slice(0, dot), entityType, path: rest.slice(dot + 1) }
}

/**
 * Describe one target key for display. Collections, globals, and blocks resolve
 * to their configured labels; a field target resolves the entity half of its
 * path the same way, so it reads "Post · branding.color" rather than the stored
 * `collection:posts.branding.color`. A block whose label is keyed by locale is
 * not in `blockLabels` and falls back to its slug, which is what an author typed
 * and recognizes.
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
		case 'block':
			return { ...parsed, label: sources.blockLabels?.[parsed.value] ?? parsed.value }
		case 'collection':
			return { ...parsed, label: findLabel(sources.collections, parsed.value) ?? parsed.value }
		case 'global':
			return { ...parsed, label: findLabel(sources.globals, parsed.value) ?? parsed.value }
		case 'field': {
			const field = parseFieldTarget(parsed.value)
			if (!field) {
				return { ...parsed, label: parsed.value }
			}
			const entities = field.entityType === 'collection' ? sources.collections : sources.globals
			const entityLabel = findLabel(entities, field.entitySlug) ?? field.entitySlug
			return { ...parsed, label: `${entityLabel} · ${field.path}` }
		}
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

/**
 * The target keys worth showing as chips: everything except field targets.
 *
 * A guide written about a form usually attaches to many of its fields, so field
 * chips both crowd out the entity chips beside them and say nothing a reader can
 * act on: "Post · branding.color" names a place they are already looking at, and
 * twelve of those name it twelve times. The field surfaces carry their own help,
 * which is where a field target earns its keep.
 */
export const chipTargetKeys = (keys: string[] | undefined): string[] =>
	(keys ?? []).filter((key) => parseTargetKey(key)?.kind !== 'field')
