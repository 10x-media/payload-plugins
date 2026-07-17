import { describe, expect, it } from 'vitest'
import type { IconMeta } from '../../../types'
import { manifest as lucideManifest } from '../adapters/lucide/generated/manifest'
import { manifest as tablerManifest } from '../adapters/tabler/generated/manifest'
import { buildIconSearchIndex, type IconSearchIndex, searchIcons } from './search'

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

/**
 * Ranking only misbehaves at scale: the small fixture above cannot produce the
 * hundreds-strong score ties that made the canonical icon sink below its own
 * variants. These run against the committed manifests for that reason.
 */
describe('icon search ranking over the committed manifests', () => {
	const lucideIndex = buildIconSearchIndex(lucideManifest.icons)
	const tablerIndex = buildIconSearchIndex(tablerManifest.icons)

	const top = (index: IconSearchIndex, query: string, count: number): string[] =>
		searchIcons(index, query)
			.slice(0, count)
			.map((icon) => icon.name)

	it('surfaces the canonical icon of a large prefix group', () => {
		expect(top(tablerIndex, 'arrow', 5)).toContain('arrow-up')
		expect(top(tablerIndex, 'chevron right', 5)).toContain('chevron-right')
	})

	it('surfaces the canonical icon of a large tag group', () => {
		expect(top(lucideIndex, 'home', 5)).toContain('house')
		expect(top(lucideIndex, 'hom', 5)).toContain('house')
	})

	it('ranks every name-prefix match above every match found elsewhere', () => {
		const names = searchIcons(lucideIndex, 'ho').map((icon) => icon.name)
		const lastPrefixed = names.findLastIndex((name) => name.startsWith('ho'))
		const firstElsewhere = names.findIndex((name) => !name.startsWith('ho'))
		expect(lastPrefixed).toBeGreaterThan(0)
		expect(names.slice(firstElsewhere)).toContain('anchor')
		expect(lastPrefixed).toBeLessThan(firstElsewhere)
		expect(names.slice(0, 5)).toContain('house')
	})
})
