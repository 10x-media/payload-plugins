import { describe, expect, it } from 'vitest'

import { compareTargetEntries, targetKeysForDoc, type WikiTargetEntry } from './targetKeys'

const entry = (overrides: Partial<WikiTargetEntry>): WikiTargetEntry => ({
	featured: false,
	featuredOrder: null,
	id: 1,
	slug: null,
	summary: null,
	title: null,
	...overrides,
})

describe('targetKeysForDoc', () => {
	it('builds one key per stored value, per kind', () => {
		expect(
			targetKeysForDoc({
				targetBlocks: ['cta'],
				targetCollections: ['posts', 'products'],
				targetFields: ['collection:posts.hero.title', 'global:settings.siteName'],
				targetGlobals: ['settings'],
			})
		).toEqual([
			'collection:posts',
			'collection:products',
			'global:settings',
			'field:collection:posts.hero.title',
			'field:global:settings.siteName',
			'block:cta',
		])
	})

	it('tolerates absent, null, and empty values', () => {
		expect(targetKeysForDoc({ targetCollections: null, targetFields: [''] })).toEqual([])
		expect(targetKeysForDoc(undefined)).toEqual([])
	})

	it('deduplicates repeated values', () => {
		expect(targetKeysForDoc({ targetCollections: ['posts', 'posts'] })).toEqual([
			'collection:posts',
		])
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
