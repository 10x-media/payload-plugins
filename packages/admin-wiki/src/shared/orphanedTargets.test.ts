import { describe, expect, it } from 'vitest'

import { collectOrphanedTargets } from './orphanedTargets'

describe('collectOrphanedTargets', () => {
	const valid = ['collection:posts', 'field:posts.title', 'block:hero']

	it('reports only keys missing from the valid set', () => {
		const orphans = collectOrphanedTargets(
			[
				{
					id: 1,
					targets: [
						{ collectionSlug: 'posts', type: 'collection' },
						{ fieldPath: 'posts.gone', type: 'field' },
						{ blockSlug: 'removed', type: 'block' },
					],
					title: 'Guide',
				},
			],
			valid
		)
		expect(orphans).toEqual([
			{ id: 1, orphanedKeys: ['field:posts.gone', 'block:removed'], slug: null, title: 'Guide' },
		])
	})

	it('ignores incomplete rows and guides with no orphans', () => {
		const orphans = collectOrphanedTargets(
			[
				{ id: 1, targets: [{ type: 'field' }], title: 'Incomplete' },
				{ id: 2, targets: [{ blockSlug: 'hero', type: 'block' }], title: 'Fine' },
				{ id: 3, targets: null, title: 'Empty' },
			],
			valid
		)
		expect(orphans).toEqual([])
	})
})
