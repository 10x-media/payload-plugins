import type { FlattenedField, SanitizedConfig } from 'payload'
import { fieldIsVirtual, fieldShouldBeLocalized } from 'payload/shared'

import { blocksOf } from '../merge/compare'
import type { ReferenceSpec } from './types'

type Found = Omit<ReferenceSpec, 'policy' | 'uniquePer'> & {
	unique: boolean
	/** An array or blocks field lies on the way, so the value sits in rows. */
	inRows: boolean
	hasMany: boolean
}

/**
 * Whether a query by `path` may miss documents. At a blocks field Payload follows the next
 * segment into the first block that has a field of that name (`getLocalizedPaths`): with two
 * such blocks the second is never asked, and when the first has no rest of the path the query
 * is refused as invalid.
 */
export const pathIsAmbiguous = (
	config: SanitizedConfig,
	fields: FlattenedField[],
	path: string
): boolean => {
	const [head, ...rest] = path.split('.')
	const field = fields.find((entry) => entry.name === head)
	if (!field || rest.length === 0) return false
	const below = rest.join('.')
	if (field.type === 'group' || field.type === 'tab' || field.type === 'array') {
		return pathIsAmbiguous(config, field.flattenedFields, below)
	}
	if (field.type === 'blocks') {
		const named = blocksOf(field, config.blocks).filter((block) =>
			block.flattenedFields.some((entry) => entry.name === rest[0])
		)
		return (
			named.length > 1 ||
			named.some((block) => pathIsAmbiguous(config, block.flattenedFields, below))
		)
	}
	return false
}

/**
 * Where a value per locale begins on `ref.path`: the index of the first segment whose field is
 * localized, along the first way through blocks, or null when nothing on it is.
 */
export const localizedSegment = (
	config: SanitizedConfig,
	fields: FlattenedField[],
	ref: Pick<ReferenceSpec, 'blocks' | 'path'>
): number | null => {
	const segments = ref.path.split('.')
	const way = ref.blocks?.[0] ?? {}
	let current = fields
	for (const [index, name] of segments.entries()) {
		const field = current.find((entry) => entry.name === name)
		if (!field) return null
		if ('localized' in field && field.localized === true) return index
		if (field.type === 'blocks') {
			const slug = way[segments.slice(0, index + 1).join('.')]
			const block = blocksOf(field, config.blocks).find((entry) => entry.slug === slug)
			if (!block) return null
			current = block.flattenedFields
		} else if ('flattenedFields' in field) {
			current = field.flattenedFields
		} else {
			return null
		}
	}
	return null
}

/**
 * Whether the SQL adapters can find documents by a query on `ref.path`. `@payloadcms/drizzle`
 * names the tables it looks in after the field's parent, where the schema names some after the
 * collection: a blocks field in rows or under a localized group, and an array under a localized
 * group or array, are never found. It also keeps a localized named tab's fields in the main table, which
 * the schema puts in the locales table, and fails on a polymorphic relationship inside blocks.
 * A list of pointers is kept in a relations table by its path, which drizzle builds with a
 * `%` for every block it tried first: past the first block of a field it never matches.
 */
export const pathQueryable = (
	config: SanitizedConfig,
	fields: FlattenedField[],
	ref: Pick<ReferenceSpec, 'blocks' | 'path' | 'polymorphic'>
): boolean => {
	const segments = ref.path.split('.')
	return (ref.blocks?.length ? ref.blocks : [{}]).every((way) => {
		let current = fields
		let rows = false
		let localized = false
		let later = false
		for (const [index, name] of segments.entries()) {
			const field = current.find((entry) => entry.name === name)
			if (!field) return true
			if (index === segments.length - 1) {
				if (ref.polymorphic && Object.keys(way).length > 0) return false
				return !(later && 'hasMany' in field && field.hasMany === true)
			}
			const own = 'localized' in field && field.localized === true
			if (field.type === 'blocks') {
				if (rows || localized) return false
				const slug = way[segments.slice(0, index + 1).join('.')]
				const block = blocksOf(field, config.blocks).find((entry) => entry.slug === slug)
				if (!block) return true
				// In the order drizzle tries them.
				const order = (field.blockReferences ?? field.blocks).map((entry) =>
					typeof entry === 'string' ? entry : entry.slug
				)
				later ||= order.indexOf(slug as string) > 0
				current = block.flattenedFields
				rows = true
			} else if (field.type === 'array') {
				if (localized) return false
				rows = true
				localized ||= own
				current = field.flattenedFields
			} else if (field.type === 'tab') {
				if (own) return false
				current = field.flattenedFields
			} else if (field.type === 'group') {
				localized ||= own
				current = field.flattenedFields
			} else {
				return true
			}
		}
		return true
	})
}

const walk = (args: {
	config: SanitizedConfig
	collection: string
	global: boolean
	target: string
	fields: FlattenedField[]
	prefix: string
	inRows: boolean
	parentIsLocalized: boolean
	/** The block type at every blocks field passed so far, keyed by its path. */
	route: Record<string, string>
	out: Map<string, Found>
}): void => {
	for (const field of args.fields) {
		if (field.type === 'join' || fieldIsVirtual(field)) continue
		const path = args.prefix ? `${args.prefix}.${field.name}` : field.name
		// The value differs per locale when the field is localized or something it sits in is.
		const localized =
			args.parentIsLocalized ||
			fieldShouldBeLocalized({ field, parentIsLocalized: args.parentIsLocalized })
		const next = { ...args, prefix: path, parentIsLocalized: localized }
		if (field.type === 'relationship' || field.type === 'upload') {
			const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo]
			if (!(targets as string[]).includes(args.target)) continue
			const found: Found = {
				collection: args.collection,
				...(args.global ? { global: true } : {}),
				path,
				inRows: args.inRows,
				hasMany: field.hasMany === true,
				polymorphic: Array.isArray(field.relationTo),
				localized,
				unique: field.unique === true,
			}
			// Fields of one name in several blocks, alike in shape, are one reference with a way
			// through each block; unlike ones stay apart, since a value is read by its shape.
			const key = `${path}|${found.hasMany}|${found.polymorphic}|${found.localized}`
			const ways = Object.keys(args.route).length > 0 ? [{ ...args.route }] : []
			const known = args.out.get(key)
			if (known) known.blocks = [...(known.blocks ?? []), ...ways]
			else args.out.set(key, { ...found, ...(ways.length > 0 ? { blocks: ways } : {}) })
		} else if (field.type === 'group' || field.type === 'tab') {
			walk({ ...next, fields: field.flattenedFields })
		} else if (field.type === 'array') {
			walk({ ...next, fields: field.flattenedFields, inRows: true })
		} else if (field.type === 'blocks') {
			for (const block of blocksOf(field, args.config.blocks)) {
				walk({
					...next,
					fields: block.flattenedFields,
					inRows: true,
					route: { ...args.route, [path]: block.slug },
				})
			}
		}
	}
}

/**
 * Every field in the app that points at `target`, read from the sanitized config. A field
 * unique on its own, or together with others in a unique index, carries those others, so
 * a merge can tell when moving a reference would make two documents collide.
 */
export const deriveReferences = (config: SanitizedConfig, target: string): ReferenceSpec[] => {
	const out: ReferenceSpec[] = []
	for (const collection of config.collections) {
		// Payload's own bookkeeping (locks, preferences, jobs) points everywhere and is not data.
		if (collection.slug.startsWith('payload-')) continue
		const found = new Map<string, Found>()
		walk({
			config,
			collection: collection.slug,
			global: false,
			target,
			fields: collection.flattenedFields,
			prefix: '',
			inRows: false,
			parentIsLocalized: false,
			route: {},
			out: found,
		})
		for (const { unique, inRows, hasMany, ...ref } of found.values()) {
			const uniquePer: string[][] = []
			// A value in rows or a list is not what an index keeps one of.
			if (!inRows && !hasMany) {
				if (unique) uniquePer.push([])
				for (const index of collection.sanitizedIndexes ?? []) {
					const paths = index.fields.map((entry) => entry.path)
					if (index.unique && paths.includes(ref.path)) {
						uniquePer.push(paths.filter((path) => path !== ref.path))
					}
				}
			}
			out.push({ ...ref, uniquePer, policy: 'repoint' })
		}
	}
	// A global is one document: nothing in it can collide with another.
	for (const global of config.globals) {
		const found = new Map<string, Found>()
		walk({
			config,
			collection: global.slug,
			global: true,
			target,
			fields: global.flattenedFields,
			prefix: '',
			inRows: false,
			parentIsLocalized: false,
			route: {},
			out: found,
		})
		for (const { unique: _, inRows: __, hasMany: ___, ...ref } of found.values()) {
			out.push({ ...ref, uniquePer: [], policy: 'repoint' })
		}
	}
	return out
}

/** A reference's place in the app; a global and a collection may share a slug. */
const placeOf = (ref: ReferenceSpec): string =>
	`${ref.global ? 'global ' : ''}${ref.collection}.${ref.path}`

/**
 * Apply the host's `references` seam and refuse an entry the schema does not have, so a
 * renamed field fails at boot instead of silently leaving references behind.
 */
export const resolveReferences = (
	derived: ReferenceSpec[],
	compose: ((derived: ReferenceSpec[]) => ReferenceSpec[]) | undefined,
	slug: string
): ReferenceSpec[] => {
	if (!compose) return derived
	const known = new Set(derived.map(placeOf))
	const resolved = compose(derived.map((ref) => ({ ...ref, uniquePer: [...ref.uniquePer] })))
	for (const ref of resolved) {
		if (!known.has(placeOf(ref))) {
			throw new Error(
				`dedupe: "${placeOf(ref)}" in the references of "${slug}" does not point at it`
			)
		}
	}
	return resolved
}
