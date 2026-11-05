import type { CollectionConfig, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { aggregatesCollection } from '../native/collections/aggregates'
import { hitsCollection } from '../native/collections/hits'
import { stateCollection } from '../native/collections/state'
import { cacheCollection } from '../surfacing/cacheCollection'
import { syncCollection } from '../sync/collection'
import {
	type CollectionRole,
	checkEditorCollection,
	expectedCollections,
	POSTGRES_IDENTIFIER_LIMIT,
	recheckCollections,
	roleOf,
	type ShapeArgs,
	shapeCollection,
	slugOfRole,
} from './collectionChecks'

const sync = (): CollectionConfig =>
	syncCollection('analytics-daily', {
		hidden: true,
		access: {
			scoped: false,
			scopeField: 'scope',
			resolveScope: async () => null,
			member: () => true,
			crossScope: () => true,
		},
		read: () => true,
	})

const builders: Array<[CollectionRole, (db: string) => CollectionConfig]> = [
	['hits', () => hitsCollection()],
	['aggregates', () => aggregatesCollection()],
	['state', () => stateCollection()],
	['cache', (db) => cacheCollection({ slug: 'analytics-cache', mongo: db === 'mongoose' })],
	['sync', () => sync()],
]

/** Shaped on Postgres, where every check applies. */
const shape = (built: CollectionConfig, role: CollectionRole, overrides?: ShapeArgs['overrides']) =>
	shapeCollection(built, {
		role,
		option: `option.${role}`,
		db: 'postgres',
		...(overrides ? { overrides } : {}),
	})

/** Shaped as is on another database. */
const shapeOn = (db: string, built: CollectionConfig, role: CollectionRole) =>
	shapeCollection(built, { role, option: `option.${role}`, db })

/** The collection with one top-level field replaced, or dropped when `next` is null. */
const withField = (
	collection: CollectionConfig,
	name: string,
	next: (field: Field) => Field | null
): CollectionConfig => ({
	...collection,
	fields: collection.fields.flatMap((field) => {
		if (!('name' in field) || field.name !== name) {
			return [field]
		}
		const replaced = next(field)
		return replaced ? [replaced] : []
	}),
})

describe('shapeCollection', () => {
	describe.each(['mongoose', 'postgres', 'sqlite'])('on %s', (db) => {
		it.each(
			builders
		)('keeps the plugin’s own %s collection as built, with no notice', (role, build) => {
			const built = build(db)
			const shaped = shapeOn(db, built, role)
			expect(shaped.notices).toEqual([])
			expect({ ...shaped.collection, custom: undefined }).toEqual({ ...built, custom: undefined })
			expect(roleOf(shaped.collection)).toBe(role)
		})
	})

	it('takes admin settings, hooks, a collection dbName and fields of the host’s own', () => {
		const shaped = shape(hitsCollection('site-hits'), 'hits', (collection) => ({
			...collection,
			dbName: 'raw_hits',
			admin: { ...collection.admin, description: 'Raw hits' },
			fields: [...collection.fields, { name: 'note', type: 'text' }],
		}))
		expect(shaped.collection.dbName).toBe('raw_hits')
		expect(shaped.notices).toEqual([])
	})

	it('finds a field moved into a row or a collapsible, which keeps it in the row', () => {
		const shaped = shape(
			cacheCollection({ slug: 'analytics-cache', mongo: false }),
			'cache',
			(c) => ({
				...c,
				fields: [{ type: 'row', fields: c.fields.slice(0, 2) }, ...c.fields.slice(2)],
			})
		)
		expect(roleOf(shaped.collection)).toBe('cache')
	})

	it('refuses an override that renames the collection, pointing at the slug option', () => {
		expect(() =>
			shape(hitsCollection(), 'hits', (collection) => ({ ...collection, slug: 'renamed' }))
		).toThrow(
			'analytics: option.hits.overrides, on the "analytics-hits" collection, renamed it to "renamed". Rename it with option.hits.slug instead'
		)
	})

	it('refuses an override that returns nothing', () => {
		expect(() => shape(hitsCollection(), 'hits', () => undefined as never)).toThrow(
			'analytics: option.hits.overrides must return the collection config it was handed'
		)
	})

	it('refuses a removed field, naming the collection and the field', () => {
		expect(() =>
			shape(hitsCollection(), 'hits', (collection) => withField(collection, 'path', () => null))
		).toThrow(
			'analytics: option.hits.overrides, on the "analytics-hits" collection, removed the "path" field.'
		)
	})

	it('sees a field removed in place, by an override that mutates what it was handed', () => {
		expect(() =>
			shape(sync(), 'sync', (collection) => {
				collection.fields.pop()
				return collection
			})
		).toThrow('removed the "syncedAt" field')
	})

	it('refuses a field moved into a named group, which takes it out of the row', () => {
		expect(() =>
			shape(stateCollection(), 'state', (collection) => ({
				...collection,
				fields: [
					...collection.fields.filter((field) => !('name' in field) || field.name !== 'kind'),
					{ name: 'meta', type: 'group', fields: [{ name: 'kind', type: 'text', required: true }] },
				],
			}))
		).toThrow('removed the "kind" field')
	})

	it('refuses a field of another type', () => {
		expect(() =>
			shape(aggregatesCollection(), 'aggregates', (collection) =>
				withField(collection, 'day', (field) => ({ ...field, type: 'text' }) as Field)
			)
		).toThrow('turned the "day" field from number into text')
	})

	it.each(['localized', 'hasMany'])('refuses a field made %s', (key) => {
		expect(() =>
			shape(hitsCollection(), 'hits', (collection) =>
				withField(collection, 'path', (field) => ({ ...field, [key]: true }) as Field)
			)
		).toThrow(`made the "path" field ${key}, which stores it outside the row`)
	})

	it('refuses a field dbName on the engine’s collections, and lets the cache’s pass', () => {
		const dbName = (field: Field) => ({ ...field, dbName: 'renamed' }) as Field
		for (const [role, built] of [
			['hits', hitsCollection()],
			['aggregates', aggregatesCollection()],
			['state', stateCollection()],
		] as const) {
			expect(() =>
				shape(built, role, (collection) => withField(collection, 'scope', dbName))
			).toThrow(`set a dbName on the "scope" field`)
		}
		const cache = cacheCollection({ slug: 'analytics-cache', mongo: false })
		expect(() => shape(cache, 'cache', (c) => withField(c, 'owner', dbName))).not.toThrow()
	})

	it('refuses a field made required, or a required one added without a fixed default', () => {
		expect(() =>
			shape(hitsCollection(), 'hits', (collection) =>
				withField(collection, 'ref', (field) => ({ ...field, required: true }) as Field)
			)
		).toThrow('made the "ref" field required. The plugin writes rows without it')
		expect(() =>
			shape(sync(), 'sync', (collection) => ({
				...collection,
				fields: [...collection.fields, { name: 'site', type: 'text', required: true }],
			}))
		).toThrow('added the required field "site" without a fixed defaultValue')
		expect(() =>
			shape(sync(), 'sync', (collection) => ({
				...collection,
				fields: [
					...collection.fields,
					{ name: 'site', type: 'text', required: true, defaultValue: () => 'main' },
				],
			}))
		).toThrow('added the required field "site" without a fixed defaultValue')
		expect(() =>
			shape(sync(), 'sync', (collection) => ({
				...collection,
				fields: [
					...collection.fields,
					{ name: 'site', type: 'text', required: true, defaultValue: 'main' },
				],
			}))
		).not.toThrow()
	})

	it('refuses a dropped unique field, field index or compound index', () => {
		const cache = () => cacheCollection({ slug: 'analytics-cache', mongo: false })
		expect(() =>
			shape(cache(), 'cache', (c) =>
				withField(c, 'key', (field) => ({ ...field, unique: false }) as Field)
			)
		).toThrow('dropped the unique index on the "key" field')
		expect(() =>
			shape(cache(), 'cache', (c) =>
				withField(c, 'readAt', (field) => ({ ...field, index: false }) as Field)
			)
		).toThrow('dropped the index on the "readAt" field')
		expect(() => shape(sync(), 'sync', (c) => ({ ...c, indexes: [] }))).toThrow(
			'dropped the unique index on source, date, scope'
		)
		expect(() =>
			shape(sync(), 'sync', (c) => ({
				...c,
				indexes: [{ fields: ['source', 'date', 'scope'] }],
			}))
		).toThrow('dropped the unique index on source, date, scope')
		expect(() =>
			shape(aggregatesCollection(), 'aggregates', (c) => ({
				...c,
				indexes: [...(c.indexes ?? []), { fields: ['gen'] }],
			}))
		).not.toThrow()
	})

	describe('Postgres names', () => {
		const long = 'a'.repeat(POSTGRES_IDENTIFIER_LIMIT + 1)

		it('refuses a table name over the limit on Postgres only', () => {
			expect(() => shape(hitsCollection(long), 'hits')).toThrow(
				`left the table name "${long}" (64 characters) too long. Postgres names hold at most 63 characters: choose a shorter slug with option.hits.slug, or a shorter table name with the collection's dbName in option.hits.overrides.`
			)
			for (const db of ['sqlite', 'mongoose']) {
				expect(() => shapeOn(db, hitsCollection(long), 'hits')).not.toThrow()
			}
		})

		it('measures the dbName rather than the slug when there is one', () => {
			expect(() =>
				shape(hitsCollection(long), 'hits', (collection) => ({ ...collection, dbName: 'hits' }))
			).not.toThrow()
			expect(() =>
				shape(hitsCollection(), 'hits', (collection) => ({ ...collection, dbName: () => long }))
			).toThrow('left the table name')
		})

		it('refuses an index Payload would name past the limit', () => {
			// 48 characters of table, then `_stale_until_idx`: 64.
			const slug = 'c'.repeat(48)
			expect(() => shape(cacheCollection({ slug, mongo: false }), 'cache')).toThrow(
				`left the index name "${slug}_stale_until_idx" (64 characters) too long`
			)
			expect(() =>
				shapeOn('mongoose', cacheCollection({ slug, mongo: true }), 'cache')
			).not.toThrow()
		})
	})

	describe('notices', () => {
		it('names every access an override replaced, without refusing it', () => {
			const shaped = shape(hitsCollection(), 'hits', (collection) => ({
				...collection,
				access: { ...collection.access, read: () => true },
			}))
			expect(shaped.notices).toEqual([
				expect.stringContaining(
					'analytics: option.hits.overrides, on the "analytics-hits" collection, replaced the plugin\'s read access.'
				),
			])
			const opened = shape(stateCollection(), 'state', (collection) => ({
				...collection,
				access: { read: () => true },
			}))
			expect(opened.notices[0]).toContain(
				"replaced the plugin's read, create, update, delete access"
			)
		})

		it('warns when REST or GraphQL the plugin keeps off is turned on', () => {
			const shaped = shape(
				cacheCollection({ slug: 'read-cache', mongo: false }),
				'cache',
				({ endpoints: _endpoints, graphQL: _graphQL, ...collection }) => collection
			)
			expect(shaped.notices).toEqual([
				expect.stringContaining(
					'turned on its REST endpoints, which the plugin keeps off: its rows are served under /api/read-cache'
				),
				expect.stringContaining('turned on its GraphQL schema, which the plugin keeps off'),
			])
		})

		it('warns about sync’s locked writes reopened, and not about its REST, which it serves', () => {
			const shaped = shape(sync(), 'sync', (collection) => ({
				...collection,
				access: { ...collection.access, create: () => true },
				endpoints: [],
			}))
			expect(shaped.notices).toEqual([
				expect.stringContaining("replaced the plugin's create access"),
			])
		})
	})
})

describe('checkEditorCollection', () => {
	const editor: CollectionConfig = {
		slug: 'analytics-goals',
		fields: [{ name: 'slug', type: 'text' }],
	}
	const check = (collection: CollectionConfig, db = 'postgres') =>
		checkEditorCollection(collection, {
			role: 'goals',
			option: 'goals.collection',
			slug: 'analytics-goals',
			db,
		})

	it('tags the collection and leaves the rest to the host', () => {
		expect(roleOf(check({ ...editor, access: { read: () => true } }))).toBe('goals')
	})

	it('refuses timestamps turned off, which every instance notices a save by', () => {
		expect(() => check({ ...editor, timestamps: false })).toThrow(
			'analytics: goals.collection.overrides, on the "analytics-goals" collection, turned off timestamps. Every instance notices a saved document by its updatedAt'
		)
	})

	it('refuses a slug the overrides changed', () => {
		expect(() => check({ ...editor, slug: 'goals' })).toThrow(
			'renamed it to "goals". Rename it with goals.collection.slug instead'
		)
	})

	it('counts the timestamp indexes Payload adds against the Postgres limit', () => {
		const slug = 'a'.repeat(POSTGRES_IDENTIFIER_LIMIT - '_created_at_idx'.length + 1)
		const collection = { ...editor, slug }
		const args = { role: 'goals' as const, option: 'goals.collection', slug, db: 'postgres' }
		expect(() => checkEditorCollection(collection, args)).toThrow(`"${slug}_created_at_idx"`)
		expect(() => checkEditorCollection(collection, { ...args, db: 'sqlite' })).not.toThrow()
	})
})

describe('slugOfRole', () => {
	it('finds a collection by the role it was tagged with, whatever its slug', () => {
		const collections = [
			{ slug: 'pages' },
			shape(stateCollection('task-state'), 'state').collection,
			shape(hitsCollection('site-hits'), 'hits').collection,
		]
		expect(slugOfRole(collections, 'state')).toBe('task-state')
		expect(slugOfRole(collections, 'hits')).toBe('site-hits')
		expect(slugOfRole(collections, 'cache')).toBeUndefined()
		expect(slugOfRole(undefined, 'state')).toBeUndefined()
	})

	it('keeps the role however an override reshaped custom', () => {
		const shaped = shape(stateCollection(), 'state', (collection) => ({
			...collection,
			custom: {},
		}))
		expect(roleOf(shaped.collection)).toBe('state')
	})
})

describe('recheckCollections', () => {
	const editor: CollectionConfig = { slug: 'analytics-goals', fields: [] }
	const assembled = (): CollectionConfig[] => [
		shape(sync(), 'sync').collection,
		checkEditorCollection(editor, {
			role: 'goals',
			option: 'goals.collection',
			slug: 'analytics-goals',
			db: 'postgres',
		}),
		{ slug: 'pages', fields: [] },
	]

	it('reads back what the boot checked of the plugin’s own collections, and passes them as built', () => {
		const collections = assembled()
		const expected = expectedCollections(collections)
		expect(expected.map((each) => [each.slug, each.role, each.option])).toEqual([
			['analytics-daily', 'sync', 'option.sync'],
			['analytics-goals', 'goals', 'goals.collection'],
		])
		expect(() => recheckCollections(collections, expected, 'postgres')).not.toThrow()
		const spread = collections.map((collection) => ({
			...collection,
			custom: { ...collection.custom, theirs: true },
		}))
		expect(() => recheckCollections(spread, expected, 'postgres')).not.toThrow()
	})

	it('fails what a later plugin did to them, naming the collection', () => {
		const expected = expectedCollections(assembled())
		const later = (change: (collection: CollectionConfig) => CollectionConfig) =>
			assembled().map((collection) =>
				roleOf(collection) === 'sync' ? change(collection) : collection
			)
		expect(() =>
			recheckCollections(
				later((c) => ({
					...c,
					fields: [...c.fields, { name: 'site', type: 'text', required: true }],
				})),
				expected,
				'postgres'
			)
		).toThrow(
			'analytics: a plugin that runs after analytics, on the "analytics-daily" collection (option.sync), added the required field "site" without a fixed defaultValue'
		)
		expect(() =>
			recheckCollections(
				later((c) => withField(c, 'source', () => null)),
				expected,
				'postgres'
			)
		).toThrow('removed the "source" field')
		expect(() =>
			recheckCollections(
				later((c) => ({ ...c, indexes: [] })),
				expected,
				'postgres'
			)
		).toThrow('dropped the unique index on source, date, scope')
		expect(() =>
			recheckCollections(
				later((c) => ({ ...c, custom: { theirs: true } })),
				expected,
				'postgres'
			)
		).toThrow("replaced the collection's custom")
		expect(() =>
			recheckCollections(
				assembled().filter((collection) => roleOf(collection) !== 'sync'),
				expected,
				'postgres'
			)
		).toThrow('the "analytics-daily" collection that option.sync registers is gone')
		expect(() =>
			recheckCollections(
				assembled().map((c) => (c.slug === 'analytics-goals' ? { ...c, timestamps: false } : c)),
				expected,
				'postgres'
			)
		).toThrow('on the "analytics-goals" collection (goals.collection), turned off timestamps')
	})
})
