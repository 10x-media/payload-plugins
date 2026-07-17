import { describe, expect, it } from 'vitest'
import type { IconMeta } from '../../../types'
import { buildIconSearchIndex, searchIcons } from './search'

const icons: IconMeta[] = [
	{ name: 'house', tags: ['home', 'building'], categories: ['buildings'] },
	{ name: 'house-plus', tags: ['home', 'add'], categories: ['buildings'] },
	{ name: 'warehouse', tags: ['storage'], categories: ['buildings'] },
	{ name: 'heart', tags: ['love', 'like'], categories: ['shapes'] },
]

describe('icon search', () => {
	const index = buildIconSearchIndex(icons)

	it('returns everything for an empty query', () => {
		expect(searchIcons(index, '  ')).toHaveLength(4)
	})

	it('ranks exact name over prefix over substring', () => {
		const names = searchIcons(index, 'house').map((icon) => icon.name)
		expect(names).toEqual(['house', 'house-plus', 'warehouse'])
	})

	it('matches tags', () => {
		expect(searchIcons(index, 'love').map((icon) => icon.name)).toEqual(['heart'])
	})

	it('requires every token to match', () => {
		expect(searchIcons(index, 'home add').map((icon) => icon.name)).toEqual(['house-plus'])
		expect(searchIcons(index, 'home zzz')).toHaveLength(0)
	})

	it('is stable for equal scores (name ascending)', () => {
		const names = searchIcons(index, 'ho').map((icon) => icon.name)
		expect(names.indexOf('house')).toBeLessThan(names.indexOf('house-plus'))
	})
})
