import type { CollectionConfig } from 'payload'
import { flatFieldName, keysOf, optionsObject } from './optionChecks'
import { kindOf } from './values'

/** Reshapes one of the plugin's generated collections; handed the finished config, it returns one. */
export type CollectionOverrides = (collection: CollectionConfig) => CollectionConfig

/** A plugin collection's name and shape, as each option naming one takes them. */
export type AnalyticsCollectionOptions = {
	/** The slug every part of the plugin reads the collection under. */
	slug?: string
	/**
	 * Reshapes the generated collection last. It may not rename it (`slug` does that) nor take away
	 * what the plugin reads and writes: the boot checks both, naming the collection and the field.
	 */
	overrides?: CollectionOverrides
}

export interface ResolvedCollectionOption {
	slug: string
	overrides?: CollectionOverrides
}

/** Only that it is a function can be checked at run time; the option's type promises the rest. */
const isOverrides = (value: unknown): value is CollectionOverrides => typeof value === 'function'

/** `overrides` checked at boot: a function or nothing, since no object is ever merged in. */
export const overridesOf = (value: unknown, path: string): CollectionOverrides | undefined => {
	if (value === undefined) {
		return undefined
	}
	if (!isOverrides(value)) {
		throw new Error(
			`analytics: ${path} must be a function, (collection) => collection, got ${kindOf(value)}`
		)
	}
	return value
}

/** A collection slug option checked at boot, trimmed, or the default when unset. */
export const slugOf = (value: unknown, path: string, fallback: string): string => {
	if (value === undefined) {
		return fallback
	}
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`analytics: ${path} must be a non-empty collection slug, got ${kindOf(value)}`)
	}
	return value.trim()
}

/**
 * One `{ slug, overrides }` option checked at boot. `path` names it in every refusal, and `extra`
 * lists the other keys the option takes beside those two.
 */
export const resolveCollectionOption = (
	value: unknown,
	where: { path: string; fallback: string; extra?: readonly string[] }
): ResolvedCollectionOption => {
	const { path, fallback, extra = [] } = where
	if (value === undefined) {
		return { slug: fallback }
	}
	const shaped = optionsObject(value, {
		path,
		known: ['slug', 'overrides', ...extra],
		example: `an object such as { slug: '${fallback}' }`,
	})
	const overrides = overridesOf(shaped.overrides, `${path}.overrides`)
	return {
		slug: slugOf(shaped.slug, `${path}.slug`, fallback),
		...(overrides ? { overrides } : {}),
	}
}

/** The field a scoped plugin collection stamps each document's scope into, by default. */
const DEFAULT_SCOPE_FIELD = 'scope'

type CollectionAccess = Partial<CollectionConfig['access']>

const COLLECTION_ACCESS_KEYS = keysOf<NonNullable<CollectionConfig['access']>>({
	admin: true,
	create: true,
	delete: true,
	read: true,
	readVersions: true,
	unlock: true,
	update: true,
})

/** `access` on one of the plugin's collections: a Payload access function per operation. */
const assertCollectionAccess = (value: unknown, path: string): void => {
	if (value === undefined) {
		return
	}
	const access = optionsObject(value, {
		path,
		known: COLLECTION_ACCESS_KEYS,
		example: 'an object such as { read }',
	})
	for (const [operation, fn] of Object.entries(access)) {
		if (fn !== undefined && typeof fn !== 'function') {
			throw new Error(
				`analytics: ${path}.${operation} must be an access function, got ${kindOf(fn)}`
			)
		}
	}
}

/** A collection's `fields` overrides: one function per field it may replace. */
const assertFieldOverrides = (value: unknown, path: string, known: readonly string[]): void => {
	if (value === undefined) {
		return
	}
	const fields = optionsObject(value, {
		path,
		known,
		example: 'an object such as { name: ({ defaultField }) => defaultField }',
	})
	for (const [name, override] of Object.entries(fields)) {
		if (override !== undefined && typeof override !== 'function') {
			throw new Error(
				`analytics: ${path}.${name} must be a function receiving { defaultField }, got ${kindOf(override)}`
			)
		}
	}
}

/** What an opt-in collection whose documents belong to a scope takes (goals, providers). */
interface ScopedCollectionOptions<TFields> {
	slug?: string
	scopeField?: string
	fields?: TFields
	overrides?: CollectionOverrides
	access?: CollectionAccess
}

/** A scoped collection option resolved: on or off, its slug and scope field filled. */
export interface ResolvedScopedCollection<TFields> {
	enabled: boolean
	slug: string
	scopeField: string
	fields?: TFields
	overrides?: CollectionOverrides
	access?: CollectionAccess
}

/** Where a scoped collection option sits, and what it takes. */
interface ScopedCollectionAt {
	path: string
	fallback: string
	/** Every key the option takes. */
	known: readonly string[]
	/** The fields its `fields` may replace. */
	fieldKeys: readonly string[]
	/** The custom slug a refusal shows as an example. */
	exampleSlug: string
}

/**
 * A scoped collection option: off when unset or false, on under its defaults for `true`, and an
 * object checked for its keys, `fields`, `access`, `overrides`, slug and scope field.
 */
export const resolveScopedCollection = <TFields>(
	option: boolean | ScopedCollectionOptions<TFields> | undefined,
	at: ScopedCollectionAt
): ResolvedScopedCollection<TFields> => {
	if (option === undefined || typeof option === 'boolean') {
		return { enabled: option === true, slug: at.fallback, scopeField: DEFAULT_SCOPE_FIELD }
	}
	const shaped = optionsObject(option, {
		path: at.path,
		known: at.known,
		example: `true, or an object such as { slug: '${at.exampleSlug}' }`,
	})
	assertFieldOverrides(shaped.fields, `${at.path}.fields`, at.fieldKeys)
	assertCollectionAccess(shaped.access, `${at.path}.access`)
	const overrides = overridesOf(option.overrides, `${at.path}.overrides`)
	return {
		enabled: true,
		slug: slugOf(option.slug, `${at.path}.slug`, at.fallback),
		scopeField: flatFieldName(option.scopeField ?? DEFAULT_SCOPE_FIELD, {
			path: `${at.path}.scopeField`,
			reason: 'the scope stamp writes it as a flat key',
		}),
		...(option.fields ? { fields: option.fields } : {}),
		...(overrides ? { overrides } : {}),
		...(option.access ? { access: option.access } : {}),
	}
}
