import { describe, expect, it } from 'vitest'

import { addFieldTarget, groupFieldTargets, toggleFieldTarget } from './fieldTargetGroups'

const sources = {
	blockLabels: { heroBanner: 'Hero banner' },
	collections: [{ labels: { singular: 'Post' }, slug: 'posts' }, { slug: 'products' }],
	globals: [{ label: 'Site settings', slug: 'settings' }],
}

const covered = {
	blocks: ['cta', 'heroBanner'],
	collections: ['posts', 'products'],
	globals: ['settings'],
}

describe('groupFieldTargets', () => {
	it('groups by owner and strips the owner prefix from each path', () => {
		expect(
			groupFieldTargets(
				['collection:posts.title', 'collection:posts.branding.color'],
				sources,
				covered
			)
		).toEqual([
			{
				id: 'collection:posts',
				kind: 'collection',
				label: 'Post',
				slug: 'posts',
				targets: [
					{ label: 'title', value: 'collection:posts.title' },
					{ label: 'branding.color', value: 'collection:posts.branding.color' },
				],
			},
		])
	})

	it('orders collections, then globals, then blocks, then the unresolved catch-all', () => {
		const grouped = groupFieldTargets(
			[
				'block:heroBanner.heading',
				'nonsense',
				'global:settings.siteName',
				'collection:posts.title',
			],
			sources,
			covered
		)
		expect(grouped.map((group) => group.id)).toEqual([
			'collection:posts',
			'global:settings',
			'block:heroBanner',
			'unresolved',
		])
	})

	it('sorts same-kind groups by label', () => {
		const grouped = groupFieldTargets(
			['collection:products.name', 'collection:posts.title'],
			sources,
			covered
		)
		expect(grouped.map((group) => group.label)).toEqual(['Post', 'products'])
	})

	it('treats an owner missing from the covered slugs as unresolved, under its raw value', () => {
		expect(groupFieldTargets(['collection:gone.legacy'], sources, covered)).toEqual([
			{
				id: 'unresolved',
				kind: 'unresolved',
				label: '',
				slug: '',
				targets: [{ label: 'collection:gone.legacy', value: 'collection:gone.legacy' }],
			},
		])
	})

	it('collects unparseable values into the same unresolved group', () => {
		const grouped = groupFieldTargets(['posts.title', 'collection:posts'], sources, covered)
		expect(grouped).toHaveLength(1)
		expect(grouped[0]?.targets.map((target) => target.value)).toEqual([
			'posts.title',
			'collection:posts',
		])
	})

	it('falls back to the slug where the owner declares no resolvable label', () => {
		expect(groupFieldTargets(['block:cta.label'], sources, covered)[0]?.label).toBe('cta')
	})

	it('ignores empty and non-string values', () => {
		expect(groupFieldTargets(undefined, sources, covered)).toEqual([])
		expect(groupFieldTargets(['', null as unknown as string], sources, covered)).toEqual([])
	})
})

describe('addFieldTarget', () => {
	it('appends, and is a no-op for a value already stored', () => {
		expect(addFieldTarget(['a'], 'b')).toEqual(['a', 'b'])
		expect(addFieldTarget(['a', 'b'], 'a')).toEqual(['a', 'b'])
		expect(addFieldTarget(undefined, 'a')).toEqual(['a'])
	})
})

describe('toggleFieldTarget', () => {
	it('adds a missing value and removes a present one, keeping the rest in order', () => {
		expect(toggleFieldTarget(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
		expect(toggleFieldTarget(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
	})
})
