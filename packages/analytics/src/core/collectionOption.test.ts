import type { CollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import { overridesOf, resolveCollectionOption, slugOf } from './collectionOption'

const where = { path: 'cache.collection', fallback: 'analytics-cache' }

describe('resolveCollectionOption', () => {
	it('takes the default slug when unset, and trims a given one', () => {
		expect(resolveCollectionOption(undefined, where)).toEqual({ slug: 'analytics-cache' })
		expect(resolveCollectionOption({}, where)).toEqual({ slug: 'analytics-cache' })
		const overrides = (collection: CollectionConfig) => collection
		expect(resolveCollectionOption({ slug: ' read-cache ', overrides }, where)).toEqual({
			slug: 'read-cache',
			overrides,
		})
	})

	it('takes the extra keys an option allows, and refuses any other', () => {
		const sync = { path: 'sync.collection', fallback: 'analytics-daily', extra: ['hidden'] }
		expect(resolveCollectionOption({ hidden: false }, sync)).toEqual({ slug: 'analytics-daily' })
		expect(() => resolveCollectionOption({ dbName: 'cache' }, where)).toThrow(
			'analytics: cache.collection.dbName is not an option; cache.collection takes slug and overrides'
		)
	})

	it('refuses what is not an object, naming the option', () => {
		expect(() => resolveCollectionOption('read-cache', where)).toThrow(
			`analytics: cache.collection must be an object such as { slug: 'analytics-cache' }, got "read-cache"`
		)
		expect(() => resolveCollectionOption([], where)).toThrow('got an array')
	})
})

describe('overridesOf and slugOf', () => {
	it('takes a function or nothing as overrides', () => {
		expect(overridesOf(undefined, 'x.overrides')).toBeUndefined()
		expect(() => overridesOf({ admin: {} }, 'x.overrides')).toThrow(
			'analytics: x.overrides must be a function, (collection) => collection, got object'
		)
	})

	it('refuses an empty slug or one of another type', () => {
		expect(slugOf(undefined, 'x.slug', 'fallback')).toBe('fallback')
		expect(() => slugOf('  ', 'x.slug', 'fallback')).toThrow(
			'analytics: x.slug must be a non-empty collection slug, got "  "'
		)
		expect(() => slugOf(7, 'x.slug', 'fallback')).toThrow('got number')
	})
})
