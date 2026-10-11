import { describe, expect, it } from 'vitest'
import { itemCollectionsOf, readReportMode, reportModes } from './report'

describe('reportModes', () => {
	it('follows the binding when left on auto, the item before the page', () => {
		expect(reportModes({ item: true })).toEqual(['item'])
		expect(reportModes({ pathField: 'slug' })).toEqual(['page'])
		expect(reportModes({ path: () => '/a', item: true })).toEqual(['item', 'page'])
	})

	it('falls back to the page for a binding that names neither', () => {
		expect(reportModes(undefined)).toEqual(['page'])
	})

	it('offers a pinned report alone, even where the binding lacks it', () => {
		expect(reportModes({ path: () => '/a', item: true }, 'page')).toEqual(['page'])
		expect(reportModes({ pathField: 'slug' }, 'item')).toEqual(['item'])
	})
})

describe('readReportMode', () => {
	it('reads the two reports and nothing else', () => {
		expect(readReportMode('item')).toBe('item')
		expect(readReportMode('page')).toBe('page')
		expect(readReportMode('auto')).toBeUndefined()
		expect(readReportMode(null)).toBeUndefined()
	})
})

describe('itemCollectionsOf', () => {
	it('lists the collections bound as items', () => {
		const collections = itemCollectionsOf({
			pages: { pathField: 'slug' },
			offers: { item: true },
			products: { path: () => '/p', item: true },
		})
		expect([...collections].sort()).toEqual(['offers', 'products'])
	})
})
