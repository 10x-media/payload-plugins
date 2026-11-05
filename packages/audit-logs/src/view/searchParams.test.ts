import { describe, expect, it } from 'vitest'

import { normalizeSearchParams } from './searchParams'

describe('normalizeSearchParams', () => {
	it('leaves Next-shaped params as they are', () => {
		expect(normalizeSearchParams({ collection: 'posts', operation: ['update', 'delete'] })).toEqual(
			{
				collection: 'posts',
				operation: ['update', 'delete'],
			}
		)
	})

	it('folds indexed keys into an array, in index order', () => {
		expect(
			normalizeSearchParams({
				'operation[1]': 'delete',
				'operation[0]': 'update',
				page: '2',
			})
		).toEqual({ operation: ['update', 'delete'], page: '2' })
	})

	it('folds custom filter keys with a dot in them', () => {
		expect(normalizeSearchParams({ 'f.status[0]': 'draft', 'f.status[1]': 'review' })).toEqual({
			'f.status': ['draft', 'review'],
		})
	})

	it('leaves deeper bracket keys alone', () => {
		expect(normalizeSearchParams({ 'where[or][0][title][equals]': 'x' })).toEqual({
			'where[or][0][title][equals]': 'x',
		})
	})

	it('handles a missing object', () => {
		expect(normalizeSearchParams(undefined)).toEqual({})
	})
})
