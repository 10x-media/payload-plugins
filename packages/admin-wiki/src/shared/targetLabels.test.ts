import { describe, expect, it } from 'vitest'

import { chipTargetKeys, describeTarget, describeTargets, parseTargetKey } from './targetLabels'

const sources = {
	collections: [{ labels: { singular: 'Post' }, slug: 'posts' }, { slug: 'products' }],
	customLabels: { dashboard: 'Dashboard' },
	globals: [{ label: 'Site settings', slug: 'settings' }],
}

describe('parseTargetKey', () => {
	it('splits a key into kind and value', () => {
		expect(parseTargetKey('collection:posts')).toEqual({ kind: 'collection', value: 'posts' })
		expect(parseTargetKey('field:collection:posts.hero.title')).toEqual({
			kind: 'field',
			value: 'collection:posts.hero.title',
		})
	})

	it('parses a custom target', () => {
		expect(parseTargetKey('custom:dashboard.attention')).toEqual({
			kind: 'custom',
			value: 'dashboard.attention',
		})
	})

	it('rejects unknown kinds, missing values, and missing separators', () => {
		expect(parseTargetKey('widget:x')).toBeNull()
		expect(parseTargetKey('collection:')).toBeNull()
		expect(parseTargetKey('collection')).toBeNull()
		expect(parseTargetKey(':posts')).toBeNull()
	})
})

describe('describeTarget', () => {
	it('prefers the singular label, then label, then the slug', () => {
		expect(describeTarget('collection:posts', sources)?.label).toBe('Post')
		expect(describeTarget('collection:products', sources)?.label).toBe('products')
		expect(describeTarget('global:settings', sources)?.label).toBe('Site settings')
	})

	it('falls back to the slug for entities absent from the config', () => {
		expect(describeTarget('collection:gone', sources)?.label).toBe('gone')
	})

	it('resolves the entity half of a field path', () => {
		expect(describeTarget('field:collection:posts.hero.title', sources)).toEqual({
			kind: 'field',
			label: 'Post · hero.title',
			value: 'collection:posts.hero.title',
		})
		expect(describeTarget('field:global:settings.siteName', sources)?.label).toBe(
			'Site settings · siteName'
		)
		expect(describeTarget('field:collection:gone.title', sources)?.label).toBe('gone · title')
	})

	it('resolves the block half of a block-scoped field path', () => {
		const withBlocks = { ...sources, blockLabels: { heroBanner: 'Hero banner' } }
		expect(describeTarget('field:block:heroBanner.headline', withBlocks)).toEqual({
			kind: 'field',
			label: 'Hero banner · headline',
			value: 'block:heroBanner.headline',
		})
		expect(describeTarget('field:block:quote.body', withBlocks)?.label).toBe('quote · body')
	})

	it('shows unqualified field paths verbatim', () => {
		expect(describeTarget('field:posts.title', sources)?.label).toBe('posts.title')
	})

	it('resolves a block label when the walker collected one, else the slug', () => {
		const withBlocks = { ...sources, blockLabels: { heroBanner: 'Hero banner' } }
		expect(describeTarget('block:heroBanner', withBlocks)?.label).toBe('Hero banner')
		expect(describeTarget('block:quote', withBlocks)?.label).toBe('quote')
		expect(describeTarget('block:heroBanner', sources)?.label).toBe('heroBanner')
	})
})

describe('describeTargets', () => {
	it('drops keys that no longer parse', () => {
		expect(describeTargets(['collection:posts', 'nonsense'], sources)).toEqual([
			{ kind: 'collection', label: 'Post', value: 'posts' },
		])
	})
})

describe('describeTarget, custom kind', () => {
	it('uses the declared label, and the bare key when none was declared', () => {
		expect(describeTarget('custom:dashboard', sources)?.label).toBe('Dashboard')
		expect(describeTarget('custom:traffic', sources)).toEqual({
			kind: 'custom',
			label: 'traffic',
			value: 'traffic',
		})
	})
})

describe('chipTargetKeys', () => {
	it('drops field targets and keeps everything else', () => {
		expect(
			chipTargetKeys([
				'collection:posts',
				'field:collection:posts.title',
				'global:settings',
				'block:heroBanner',
			])
		).toEqual(['collection:posts', 'global:settings', 'block:heroBanner'])
	})

	it('keeps custom targets, which stand in for the entities they name', () => {
		expect(chipTargetKeys(['custom:dashboard', 'field:collection:posts.title'])).toEqual([
			'custom:dashboard',
		])
	})

	it('drops block targets only when asked to', () => {
		const keys = ['collection:posts', 'block:heroBanner', 'global:settings']
		expect(chipTargetKeys(keys, { blocks: false })).toEqual(['collection:posts', 'global:settings'])
		expect(chipTargetKeys(keys, { blocks: true })).toEqual(keys)
		expect(chipTargetKeys(keys, {})).toEqual(keys)
	})

	it('tolerates undefined and unparseable keys', () => {
		expect(chipTargetKeys(undefined)).toEqual([])
		expect(chipTargetKeys(['nonsense'])).toEqual(['nonsense'])
		expect(chipTargetKeys(['nonsense'], { blocks: false })).toEqual(['nonsense'])
	})
})
