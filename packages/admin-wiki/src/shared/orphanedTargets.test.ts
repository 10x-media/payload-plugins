import { describe, expect, it } from 'vitest'

import { collectOrphanedTargets } from './orphanedTargets'

describe('collectOrphanedTargets', () => {
	const valid = ['collection:posts', 'field:collection:posts.title', 'block:hero']

	it('reports only keys missing from the valid set', () => {
		const orphans = collectOrphanedTargets(
			[
				{
					id: 1,
					targetBlocks: ['removed'],
					targetCollections: ['posts'],
					targetFields: ['collection:posts.gone'],
					title: 'Guide',
				},
			],
			valid
		)
		expect(orphans).toEqual([
			{
				id: 1,
				orphanedKeys: ['field:collection:posts.gone', 'block:removed'],
				slug: null,
				title: 'Guide',
			},
		])
	})

	it('ignores empty values and guides with no orphans', () => {
		const orphans = collectOrphanedTargets(
			[
				{ id: 1, targetFields: [''], title: 'Incomplete' },
				{ id: 2, targetBlocks: ['hero'], title: 'Fine' },
				{ id: 3, targetCollections: null, title: 'Empty' },
			],
			valid
		)
		expect(orphans).toEqual([])
	})
})
