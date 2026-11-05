import type { CollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import type { ViewFilter } from '../types'
import { hasFieldPath, validateViewFilters } from './viewFilters'

const collection: CollectionConfig = {
	slug: 'audit-logs',
	fields: [
		{ name: 'actorDepartments', type: 'text', hasMany: true },
		{ type: 'row', fields: [{ name: 'source', type: 'text' }] },
		{ name: 'actor', type: 'group', fields: [{ name: 'team', type: 'text' }] },
	],
}

const filter = (overrides: Partial<ViewFilter> = {}): ViewFilter => ({
	type: 'relationship',
	name: 'department',
	label: 'Department',
	path: 'actorDepartments',
	relationTo: 'departments' as ViewFilter['relationTo'],
	...overrides,
})

describe('hasFieldPath', () => {
	it('finds top-level fields, through rows, and inside groups', () => {
		expect(hasFieldPath(collection.fields, 'actorDepartments')).toBe(true)
		expect(hasFieldPath(collection.fields, 'source')).toBe(true)
		expect(hasFieldPath(collection.fields, 'actor.team')).toBe(true)
	})

	it('misses what is not there', () => {
		expect(hasFieldPath(collection.fields, 'missing')).toBe(false)
		expect(hasFieldPath(collection.fields, 'actor.missing')).toBe(false)
		expect(hasFieldPath(collection.fields, 'source.deeper')).toBe(false)
	})
})

describe('validateViewFilters', () => {
	it('accepts filters over existing fields', () => {
		expect(() =>
			validateViewFilters(collection, [filter(), filter({ name: 'team', path: 'actor.team' })])
		).not.toThrow()
	})

	it('refuses a path the collection does not have', () => {
		expect(() => validateViewFilters(collection, [filter({ path: 'nope' })])).toThrow(
			/no field 'nope'/
		)
	})

	it('refuses a duplicate name', () => {
		expect(() => validateViewFilters(collection, [filter(), filter()])).toThrow(/used twice/)
	})

	it('refuses a name that is not URL-safe', () => {
		expect(() => validateViewFilters(collection, [filter({ name: 'a b' })])).toThrow(/name/)
	})
})
