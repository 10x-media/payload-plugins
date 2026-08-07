import { describe, expect, it } from 'vitest'

import { compareTargetEntries, targetKeyForRow, type WikiTargetEntry } from './targetKeys'

const entry = (overrides: Partial<WikiTargetEntry>): WikiTargetEntry => ({
	featured: false,
	featuredOrder: null,
	id: 1,
	slug: null,
	summary: null,
	title: null,
	...overrides,
})

describe('targetKeyForRow', () => {
	it('builds keys per target type', () => {
		expect(targetKeyForRow({ collectionSlug: 'posts', type: 'collection' })).toBe(
			'collection:posts'
		)
		expect(targetKeyForRow({ globalSlug: 'settings', type: 'global' })).toBe('global:settings')
		expect(targetKeyForRow({ fieldPath: 'posts.hero.title', type: 'field' })).toBe(
			'field:posts.hero.title'
		)
		expect(targetKeyForRow({ blockSlug: 'cta', type: 'block' })).toBe('block:cta')
	})

	it('returns null for incomplete rows', () => {
		expect(targetKeyForRow({ type: 'collection' })).toBeNull()
		expect(targetKeyForRow({ fieldPath: 'x.y' })).toBeNull()
	})
})

describe('compareTargetEntries', () => {
	it('sorts featured first by order, then title', () => {
		const guides = [
			entry({ title: 'Zeta' }),
			entry({ featured: true, featuredOrder: 2, title: 'B' }),
			entry({ featured: true, featuredOrder: 1, title: 'C' }),
			entry({ title: 'Alpha' }),
		]
		const sorted = [...guides].sort(compareTargetEntries)
		expect(sorted.map((guide) => guide.title)).toEqual(['C', 'B', 'Alpha', 'Zeta'])
	})
})
