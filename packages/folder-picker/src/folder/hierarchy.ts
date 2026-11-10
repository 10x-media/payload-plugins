import type { ClientCollectionConfig, Where } from 'payload'

type ID = number | string

/** What the drawer needs to know about the folder collection a related collection files into. */
export type FolderHierarchy = {
	/** The related collection's field holding the folder; Payload names it after the parent field. */
	fieldName: string
	parentFieldName: string
	/** The folder collection itself. */
	slug: string
	/** Name of the folder collection's "allowed types" select, when it is collection specific. */
	typeFieldName?: string
	/** Every collection that files into this folder collection: the type select's options. */
	typeOptions: string[]
	useAsTitle: string
}

/**
 * The folder collection `collectionSlug` files into: a hierarchy with single parents
 * (`allowHasMany: false`, what `folders: true` builds) whose sanitized `relatedCollections` list it.
 * Tag-style hierarchies are skipped, a document sits in many of those at once.
 */
export const findFolderHierarchy = (
	collections: ClientCollectionConfig[],
	collectionSlug: string
): FolderHierarchy | undefined => {
	for (const collection of collections) {
		const hierarchy = collection.hierarchy
		if (!hierarchy || typeof hierarchy !== 'object' || hierarchy.allowHasMany !== false) {
			continue
		}
		const related = hierarchy.relatedCollections?.[collectionSlug]
		if (!related) {
			continue
		}
		const collectionSpecific = hierarchy.collectionSpecific
		return {
			fieldName: related.fieldName,
			parentFieldName: hierarchy.parentFieldName,
			slug: collection.slug,
			typeFieldName:
				collectionSpecific && typeof collectionSpecific === 'object'
					? collectionSpecific.fieldName
					: undefined,
			typeOptions: Object.keys(hierarchy.relatedCollections ?? {}),
			useAsTitle: collection.admin?.useAsTitle ?? 'id',
		}
	}
	return undefined
}

/** Folders directly under `parentId`, or at the root when it is null. */
export const childrenWhere = (parentFieldName: string, parentId: ID | null): Where =>
	parentId === null
		? { or: [{ [parentFieldName]: { exists: false } }, { [parentFieldName]: { equals: null } }] }
		: { [parentFieldName]: { equals: parentId } }

/** Documents filed directly in `parentId`, or in no folder when it is null. */
export const filedInWhere = (fieldName: string, parentId: ID | null): Where =>
	parentId === null
		? { or: [{ [fieldName]: { exists: false } }, { [fieldName]: { equals: null } }] }
		: { [fieldName]: { in: [parentId] } }

/**
 * Folders that accept at least one of `collectionSlugs`, or accept anything. Payload's own view
 * offers the same choice through its Type filter; in a drawer for one field the answer is fixed.
 *
 * A folder saved with no types stores an empty array on Mongo, which `exists: false` misses, and
 * `equals: []` fails on Postgres (the select is an enum). "Holds none of the possible types" covers
 * the empty array on both: Mongo's `$nin` matches it, and on Postgres the empty select has no
 * rows, which `exists: false` already matches.
 */
export const acceptsWhere = (
	typeFieldName: string,
	collectionSlugs: string[],
	typeOptions: string[]
): Where => ({
	or: [
		{ [typeFieldName]: { in: collectionSlugs } },
		{ [typeFieldName]: { exists: false } },
		{ [typeFieldName]: { not_in: typeOptions } },
	],
})

/** Hides documents the field already holds, the way Payload's upload field filters its list. */
export const notChosenWhere = (ids: string[]): Where | undefined =>
	ids.length > 0 ? { id: { not_in: ids } } : undefined

/** `and` of the defined constraints, or undefined when none is. */
export const andWhere = (...constraints: Array<Where | undefined>): Where | undefined => {
	const defined = constraints.filter((constraint): constraint is Where => Boolean(constraint))
	if (defined.length === 0) {
		return undefined
	}
	return defined.length === 1 ? defined[0] : { and: defined }
}
