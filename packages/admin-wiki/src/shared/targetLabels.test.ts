import { describe, expect, it } from 'vitest'

import { describeTarget, describeTargets, parseTargetKey } from './targetLabels'

const sources = {
	collections: [{ labels: { singular: 'Post' }, slug: 'posts' }, { slug: 'products' }],
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

	it('shows unqualified field paths and block slugs verbatim', () => {
		expect(describeTarget('field:posts.title', sources)?.label).toBe('posts.title')
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
