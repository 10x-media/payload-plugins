import type { CollectionConfig, Field } from 'payload'
import type { CollectionOverrides } from '../core/collectionOption'
import { isRecord } from '../core/values'
import { knownDbKind } from '../db/kind'
import { tableKeyOf } from '../native/store/sql/executor'
import { ANALYTICS_CONFIG_KEY } from './routes'

/** Every collection the plugin registers, by what it holds. */
const COLLECTION_ROLES = [
	'hits',
	'aggregates',
	'state',
	'cache',
	'sync',
	'providers',
	'goals',
] as const

export type CollectionRole = (typeof COLLECTION_ROLES)[number]

/**
 * How much of a collection the plugin relies on: engine SQL and Mongo code read every column of
 * `engine` ones, `payload.db` uses `machine` ones by field name, editors own `editor` ones.
 */
type CollectionKind = 'engine' | 'machine' | 'editor'

const KIND_OF: Readonly<Record<CollectionRole, CollectionKind>> = {
	hits: 'engine',
	aggregates: 'engine',
	state: 'engine',
	cache: 'machine',
	sync: 'machine',
	providers: 'editor',
	goals: 'editor',
}

/** Postgres truncates any longer identifier, so a name Payload derives past it no longer matches. */
export const POSTGRES_IDENTIFIER_LIMIT = 63

/** What a collection's checks need, whether it is the config a plugin builds or the sanitized one. */
type CheckedCollection = Pick<
	CollectionConfig,
	'slug' | 'fields' | 'indexes' | 'dbName' | 'timestamps'
>

/**
 * One of the plugin's collections as the boot checked it, held so the assembled config can be
 * checked again once every plugin has run.
 */
export interface ExpectedCollection {
	role: CollectionRole
	/** The option path every message names, such as `cache.collection`. */
	option: string
	slug: string
	terms?: { fields: FieldTerms[]; indexes: IndexTerms[] }
}

/** Each role marker to what the boot checked, which a spread of `custom` carries along by reference. */
const expectations = new WeakMap<object, ExpectedCollection>()

/** Tags a collection with its role, which code holding only the assembled config finds it by. */
const withRole = (collection: CollectionConfig, expected: ExpectedCollection): CollectionConfig => {
	const marker = { role: expected.role }
	expectations.set(marker, expected)
	return { ...collection, custom: { ...collection.custom, [ANALYTICS_CONFIG_KEY]: marker } }
}

/** What the boot checked of every collection the plugin registered in `collections`. */
export const expectedCollections = (
	collections: ReadonlyArray<{ custom?: Record<string, unknown> }> | undefined
): ExpectedCollection[] =>
	(collections ?? []).flatMap((collection) => {
		const marker = collection.custom?.[ANALYTICS_CONFIG_KEY]
		const expected = isRecord(marker) ? expectations.get(marker) : undefined
		return expected ? [expected] : []
	})

/** The role a registered collection plays for the plugin, or undefined for anyone else's. */
export const roleOf = (collection: {
	custom?: Record<string, unknown>
}): CollectionRole | undefined => {
	const marker = collection.custom?.[ANALYTICS_CONFIG_KEY]
	const role = isRecord(marker) ? marker.role : undefined
	return COLLECTION_ROLES.find((each) => each === role)
}

/** The slug of the registered collection playing `role`, if any. */
export const slugOfRole = (
	collections: ReadonlyArray<{ slug: string; custom?: Record<string, unknown> }> | undefined,
	role: CollectionRole
): string | undefined => (collections ?? []).find((collection) => roleOf(collection) === role)?.slug

type NamedField = Field & { name: string }

const isNamed = (field: Field): field is NamedField =>
	'name' in field && typeof field.name === 'string' && field.name !== ''

/** Fields stored in the collection's own row: through rows, collapsibles, unnamed groups and tabs. */
const rowFieldsOf = (fields: readonly Field[]): NamedField[] =>
	fields.flatMap((field): NamedField[] => {
		if (field.type === 'row' || field.type === 'collapsible') {
			return rowFieldsOf(field.fields)
		}
		if (field.type === 'tabs') {
			return field.tabs.flatMap((tab) => ('name' in tab && tab.name ? [] : rowFieldsOf(tab.fields)))
		}
		if (field.type === 'group' && !isNamed(field)) {
			return rowFieldsOf(field.fields)
		}
		return field.type === 'ui' || !isNamed(field) ? [] : [field]
	})

const flag = (field: Field, key: string): boolean => Reflect.get(field, key) === true

/** A `defaultValue` the database itself fills in, which only a value (never a function) becomes. */
const hasFixedDefault = (field: Field): boolean => {
	const value: unknown = Reflect.get(field, 'defaultValue')
	return value !== undefined && value !== null && typeof value !== 'function'
}

/** What the plugin relies on in one of its fields, read before any override runs. */
interface FieldTerms {
	name: string
	type: Field['type']
	required: boolean
	index: boolean
	unique: boolean
}

const termsOf = (field: NamedField): FieldTerms => ({
	name: field.name,
	type: field.type,
	required: flag(field, 'required'),
	index: flag(field, 'index') || flag(field, 'unique'),
	unique: flag(field, 'unique'),
})

interface IndexTerms {
	fields: string[]
	unique: boolean
}

/** A plugin collection as built, copied out so an override mutating it in place changes nothing here. */
interface Contract {
	slug: string
	fields: FieldTerms[]
	indexes: IndexTerms[]
	access: Record<string, unknown>
	endpoints: unknown
	graphQL: unknown
}

const indexesOf = (collection: Pick<CollectionConfig, 'indexes'>): IndexTerms[] =>
	(collection.indexes ?? []).map((index) => ({
		fields: [...index.fields],
		unique: index.unique === true,
	}))

const accessOf = (collection: CollectionConfig): Record<string, unknown> => ({
	...collection.access,
})

const contractOf = (collection: CollectionConfig): Contract => ({
	slug: collection.slug,
	fields: rowFieldsOf(collection.fields).map(termsOf),
	indexes: indexesOf(collection),
	access: accessOf(collection),
	endpoints: collection.endpoints,
	graphQL: collection.graphQL,
})

/** Which collection a message is about, and the option the host shaped it through. */
interface Subject extends Pick<ExpectedCollection, 'role' | 'option' | 'slug'> {
	/** The assembled config is checked again, so what changed it was a plugin after this one. */
	later?: true
}

/** Who did what to which collection, the opening of every message. */
const about = (subject: Subject): string =>
	subject.later
		? `analytics: a plugin that runs after analytics, on the "${subject.slug}" collection (${subject.option}),`
		: `analytics: ${subject.option}.overrides, on the "${subject.slug}" collection,`

const refusal = (subject: Subject, problem: string, remedy: string): Error =>
	new Error(`${about(subject)} ${problem}. ${remedy}`)

const KEEP_FIELD =
	'The plugin reads and writes it by that name and type, so keep it as the plugin defines it, at the top level of the collection.'

const checkFields = (
	subject: Subject,
	contract: Pick<Contract, 'fields'>,
	collection: CheckedCollection
): void => {
	const kind = KIND_OF[subject.role]
	const fields = new Map(rowFieldsOf(collection.fields).map((field) => [field.name, field]))
	const known = new Set(contract.fields.map((field) => field.name))
	for (const expected of contract.fields) {
		const field = fields.get(expected.name)
		if (!field) {
			throw refusal(subject, `removed the "${expected.name}" field`, KEEP_FIELD)
		}
		if (field.type !== expected.type) {
			throw refusal(
				subject,
				`turned the "${expected.name}" field from ${expected.type} into ${field.type}`,
				KEEP_FIELD
			)
		}
		for (const key of ['localized', 'hasMany'] as const) {
			if (flag(field, key)) {
				throw refusal(
					subject,
					`made the "${expected.name}" field ${key}, which stores it outside the row`,
					KEEP_FIELD
				)
			}
		}
		if (expected.unique && !flag(field, 'unique')) {
			throw refusal(
				subject,
				`dropped the unique index on the "${expected.name}" field`,
				'The plugin relies on it to keep one row per value; keep it.'
			)
		}
		if (expected.index && !flag(field, 'index') && !flag(field, 'unique')) {
			throw refusal(
				subject,
				`dropped the index on the "${expected.name}" field`,
				"The plugin's queries rely on it; keep it, and add any index of your own beside it."
			)
		}
		if (kind === 'engine' && Reflect.get(field, 'dbName') !== undefined) {
			throw refusal(
				subject,
				`set a dbName on the "${expected.name}" field`,
				"The engine's SQL names every column after its field, so its fields take no dbName; rename the table with the collection's own dbName instead."
			)
		}
		if (kind !== 'editor' && flag(field, 'required') && !expected.required) {
			throw refusal(
				subject,
				`made the "${expected.name}" field required`,
				'The plugin writes rows without it, which a NOT NULL column refuses; leave it optional.'
			)
		}
	}
	if (kind === 'editor') {
		return
	}
	for (const [name, field] of fields) {
		if (!known.has(name) && flag(field, 'required') && !hasFixedDefault(field)) {
			throw refusal(
				subject,
				`added the required field "${name}" without a fixed defaultValue`,
				"The plugin writes rows without it, and only a fixed defaultValue becomes the column's default: a function runs in Payload's hooks, which the plugin's writes skip, so a NOT NULL column refuses them. Make it optional or give it a fixed defaultValue."
			)
		}
	}
}

const sameFields = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((name, index) => name === b[index])

const checkIndexes = (
	subject: Subject,
	contract: Pick<Contract, 'indexes'>,
	collection: CheckedCollection
): void => {
	const indexes = indexesOf(collection)
	for (const expected of contract.indexes) {
		const kept = indexes.some(
			(index) => sameFields(index.fields, expected.fields) && (index.unique || !expected.unique)
		)
		if (!kept) {
			throw refusal(
				subject,
				`dropped the ${expected.unique ? 'unique ' : ''}index on ${expected.fields.join(', ')}`,
				"The plugin's writes and queries rely on it; keep it in indexes, and add any index of your own beside it."
			)
		}
	}
}

/** Column names of every indexed field stored in the collection's own table. */
const indexedColumnsOf = (fields: readonly Field[], prefix = ''): string[] =>
	fields.flatMap((field): string[] => {
		if (field.type === 'row' || field.type === 'collapsible') {
			return indexedColumnsOf(field.fields, prefix)
		}
		if (field.type === 'tabs') {
			return field.tabs.flatMap((tab) =>
				indexedColumnsOf(
					tab.fields,
					'name' in tab && tab.name ? `${prefix}${tableKeyOf(tab.name)}_` : prefix
				)
			)
		}
		if (field.type === 'group') {
			return indexedColumnsOf(
				field.fields,
				isNamed(field) ? `${prefix}${tableKeyOf(field.name)}_` : prefix
			)
		}
		// Arrays and blocks keep their rows in tables of their own, which Payload names and checks.
		if (field.type === 'array' || field.type === 'blocks' || !isNamed(field)) {
			return []
		}
		return flag(field, 'index') || flag(field, 'unique')
			? [`${prefix}${tableKeyOf(field.name)}`]
			: []
	})

/** The collection's table in Payload's SQL adapters: its own `dbName`, else its slug in snake case. */
const tableNameOf = (collection: CheckedCollection): string => {
	const { dbName } = collection
	const named = typeof dbName === 'function' ? dbName({}) : dbName
	return typeof named === 'string' && named !== '' ? named : tableKeyOf(collection.slug)
}

/**
 * On Postgres, the table and each `<table>_<column>_idx` index must fit the identifier limit:
 * Payload skips checking the table name and shortens long index names, so either stops matching.
 */
const checkIdentifiers = (
	subject: Subject,
	collection: CheckedCollection,
	db: string | undefined
): void => {
	if (db === undefined || knownDbKind({ db: { name: db } }) !== 'postgres') {
		return
	}
	const remedy = `Postgres names hold at most ${POSTGRES_IDENTIFIER_LIMIT} characters: choose a shorter slug with ${subject.option}.slug, or a shorter table name with the collection's dbName in ${subject.option}.overrides.`
	const table = tableNameOf(collection)
	if (table.length > POSTGRES_IDENTIFIER_LIMIT) {
		throw refusal(
			subject,
			`left the table name "${table}" (${table.length} characters) too long`,
			remedy
		)
	}
	const timestamps = collection.timestamps === false ? [] : ['created_at', 'updated_at']
	for (const column of [...indexedColumnsOf(collection.fields), ...timestamps]) {
		const index = `${table}_${column}_idx`
		if (index.length > POSTGRES_IDENTIFIER_LIMIT) {
			throw refusal(
				subject,
				`left the index name "${index}" (${index.length} characters) too long`,
				remedy
			)
		}
	}
}

/** An override that swapped access, or opened REST or GraphQL: warned about, not refused. */
const reopenedNotices = (
	subject: Subject,
	contract: Contract,
	collection: CollectionConfig
): string[] => {
	const notices: string[] = []
	const access = accessOf(collection)
	const replaced = [...new Set([...Object.keys(contract.access), ...Object.keys(access)])].filter(
		(operation) => access[operation] !== contract.access[operation]
	)
	if (replaced.length > 0) {
		notices.push(
			`${about(subject)} replaced the plugin's ${replaced.join(', ')} access. The plugin reads and writes its rows below access control, so this only decides who else reaches them through the Local API, REST or GraphQL; make sure that is meant.`
		)
	}
	if (contract.endpoints === false && collection.endpoints !== false) {
		notices.push(
			`${about(subject)} turned on its REST endpoints, which the plugin keeps off: its rows are served under /api/${subject.slug} to whoever its access admits.`
		)
	}
	if (contract.graphQL === false && collection.graphQL !== false) {
		notices.push(
			`${about(subject)} turned on its GraphQL schema, which the plugin keeps off: its rows are served through GraphQL to whoever its access admits.`
		)
	}
	return notices
}

export interface ShapeArgs extends Pick<ExpectedCollection, 'role' | 'option'> {
	overrides?: CollectionOverrides
	/** `config.db.name`, which decides whether Postgres' identifier limit applies. */
	db: string | undefined
}

/** A collection with the host's overrides applied and checked, and what the boot warns about. */
export interface ShapedCollection {
	collection: CollectionConfig
	notices: string[]
}

const checkTimestamps = (subject: Subject, collection: CheckedCollection): void => {
	if (collection.timestamps === false) {
		throw refusal(
			subject,
			'turned off timestamps',
			'Every instance notices a saved document by its updatedAt, so an edit made on one server would never reach the others; keep timestamps on.'
		)
	}
}

const checkSlug = (subject: Subject, collection: CollectionConfig): void => {
	if (!isRecord(collection)) {
		throw new Error(
			`analytics: ${subject.option}.overrides must return the collection config it was handed, reshaped`
		)
	}
	if (collection.slug !== subject.slug) {
		throw refusal(
			subject,
			`renamed it to "${String(collection.slug)}"`,
			`Rename it with ${subject.option}.slug instead, which every part of the plugin reads.`
		)
	}
}

/**
 * A plugin collection with the host's `overrides` applied, held to what the plugin relies on. A
 * problem fails boot naming collection and field; reopened access, REST or GraphQL is a notice.
 */
export const shapeCollection = (built: CollectionConfig, args: ShapeArgs): ShapedCollection => {
	const contract = contractOf(built)
	const subject: Subject = { role: args.role, option: args.option, slug: contract.slug }
	const collection = args.overrides ? args.overrides(built) : built
	checkSlug(subject, collection)
	checkFields(subject, contract, collection)
	checkIndexes(subject, contract, collection)
	checkIdentifiers(subject, collection, args.db)
	return {
		collection: withRole(collection, {
			role: args.role,
			option: args.option,
			slug: contract.slug,
			terms: { fields: contract.fields, indexes: contract.indexes },
		}),
		notices: reopenedNotices(subject, contract, collection),
	}
}

/**
 * The providers or goals collection after its builder applied `overrides`, held to its option's
 * slug, timestamps (instances notice saves by `updatedAt`) and Postgres' name limit.
 */
export const checkEditorCollection = (
	collection: CollectionConfig,
	args: { role: 'providers' | 'goals'; option: string; slug: string; db: string | undefined }
): CollectionConfig => {
	const subject: Subject = { role: args.role, option: args.option, slug: args.slug }
	checkSlug(subject, collection)
	checkTimestamps(subject, collection)
	checkIdentifiers(subject, collection, args.db)
	return withRole(collection, { role: args.role, option: args.option, slug: args.slug })
}

/**
 * The plugin's collections in the assembled config, held again to what the boot checked, since a
 * later plugin can remove, require, unindex or unmark them. Each failure names its collection.
 */
export const recheckCollections = (
	collections: ReadonlyArray<CheckedCollection & { custom?: Record<string, unknown> }>,
	expected: readonly ExpectedCollection[],
	db: string | undefined
): void => {
	for (const each of expected) {
		const subject: Subject = { role: each.role, option: each.option, slug: each.slug, later: true }
		const collection = collections.find((candidate) => candidate.slug === each.slug)
		if (!collection) {
			throw new Error(
				`analytics: the "${each.slug}" collection that ${each.option} registers is gone from the assembled config: a plugin that runs after analytics removed or renamed it. Keep it registered, and rename it with ${each.option}.slug.`
			)
		}
		if (roleOf(collection) !== each.role) {
			throw refusal(
				subject,
				"replaced the collection's custom, where the plugin marks the collections it finds by role (custom['@10x-media/analytics'])",
				'Spread the custom it was handed rather than replacing it.'
			)
		}
		if (each.terms) {
			checkFields(subject, each.terms, collection)
			checkIndexes(subject, each.terms, collection)
		} else {
			checkTimestamps(subject, collection)
		}
		checkIdentifiers(subject, collection, db)
	}
}
