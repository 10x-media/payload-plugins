import { describe, expect, it } from 'vitest'

import { foldersSlugOf } from './foldersSlug'

describe('foldersSlugOf', () => {
	it('is null when no collection uses folders', () => {
		expect(foldersSlugOf({ collections: [{ slug: 'posts', fields: [] }] })).toBeNull()
	})

	it('is null when folders are turned off', () => {
		expect(
			foldersSlugOf({ collections: [{ slug: 'posts', fields: [], folders: true }], folders: false })
		).toBeNull()
	})

	it('defaults to payload-folders and follows a renamed slug', () => {
		const collections = [{ slug: 'posts', fields: [], folders: true }]
		expect(foldersSlugOf({ collections })).toBe('payload-folders')
		expect(foldersSlugOf({ collections, folders: { slug: 'folders' } })).toBe('folders')
	})
})
