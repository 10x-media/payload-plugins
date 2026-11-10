import type { ClientCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { browseStateFromURL, browseStateToParams } from './browseState'
import { ancestorTrail } from './fetchHierarchyData'
import {
	acceptsWhere,
	andWhere,
	childrenWhere,
	filedInWhere,
	findFolderHierarchy,
	notChosenWhere,
} from './hierarchy'

const collection = (config: Record<string, unknown>) => config as unknown as ClientCollectionConfig

const folders = collection({
	slug: 'folders',
	admin: { useAsTitle: 'name' },
	hierarchy: {
		allowHasMany: false,
		collectionSpecific: { fieldName: 'hierarchyType' },
		parentFieldName: '_h_folders',
		relatedCollections: { media: { fieldName: '_h_folders', hasMany: false } },
	},
})

const tags = collection({
	slug: 'tags',
	admin: {},
	hierarchy: {
		allowHasMany: true,
		parentFieldName: '_h_tags',
		relatedCollections: { media: { fieldName: '_h_tags', hasMany: true } },
	},
})

describe('findFolderHierarchy', () => {
	it('finds the folder collection a collection files into', () => {
		expect(findFolderHierarchy([folders], 'media')).toEqual({
			fieldName: '_h_folders',
			parentFieldName: '_h_folders',
			slug: 'folders',
			typeFieldName: 'hierarchyType',
			typeOptions: ['media'],
			useAsTitle: 'name',
		})
	})

	it('skips tag-style hierarchies, which hold many values per document', () => {
		expect(findFolderHierarchy([tags], 'media')).toBeUndefined()
		expect(findFolderHierarchy([tags, folders], 'media')?.slug).toBe('folders')
	})

	it('returns nothing for a collection no folder collection relates to', () => {
		expect(findFolderHierarchy([folders], 'attachments')).toBeUndefined()
	})

	it('falls back to id when the folder collection has no title field', () => {
		const untitled = collection({ ...folders, admin: {} })
		expect(findFolderHierarchy([untitled], 'media')?.useAsTitle).toBe('id')
	})
})

describe('where builders', () => {
	it('matches root folders by a missing or null parent', () => {
		expect(childrenWhere('_h_folders', null)).toEqual({
			or: [{ _h_folders: { exists: false } }, { _h_folders: { equals: null } }],
		})
		expect(childrenWhere('_h_folders', 'a')).toEqual({ _h_folders: { equals: 'a' } })
	})

	it('matches unfiled documents at the root and filed ones by `in`', () => {
		expect(filedInWhere('_h_folders', null)).toEqual({
			or: [{ _h_folders: { exists: false } }, { _h_folders: { equals: null } }],
		})
		expect(filedInWhere('_h_folders', 7)).toEqual({ _h_folders: { in: [7] } })
	})

	it('keeps folders that accept the collection or accept anything', () => {
		expect(acceptsWhere('hierarchyType', ['media'], ['files', 'media'])).toEqual({
			or: [
				{ hierarchyType: { in: ['media'] } },
				{ hierarchyType: { exists: false } },
				{ hierarchyType: { not_in: ['files', 'media'] } },
			],
		})
	})

	it('hides chosen ids and adds nothing when none are chosen', () => {
		expect(notChosenWhere(['1', '2'])).toEqual({ id: { not_in: ['1', '2'] } })
		expect(notChosenWhere([])).toBeUndefined()
	})

	it('ands only the defined constraints', () => {
		const a = { a: { equals: 1 } }
		const b = { b: { equals: 2 } }
		expect(andWhere(undefined, undefined)).toBeUndefined()
		expect(andWhere(a, undefined)).toBe(a)
		expect(andWhere(a, b)).toEqual({ and: [a, b] })
	})
})

describe('ancestorTrail', () => {
	it('reads root to current off a populated parent chain', () => {
		const doc = {
			id: 'team',
			name: 'Team',
			_h_folders: { id: 'marketing', name: 'Marketing', _h_folders: null },
		}
		expect(ancestorTrail(doc, '_h_folders', 'name')).toEqual([
			{ id: 'marketing', title: 'Marketing' },
			{ id: 'team', title: 'Team' },
		])
	})

	it('stops where population stopped', () => {
		const doc = { id: 'deep', name: 'Deep', _h_folders: 'unpopulated-id' }
		expect(ancestorTrail(doc, '_h_folders', 'name')).toEqual([{ id: 'deep', title: 'Deep' }])
	})
})

describe('browse state and the URL the view pushes', () => {
	it('round-trips folder, search and type filter', () => {
		const state = { parentId: 'abc', search: 'logo', typeFilter: 'media' }
		const params = browseStateToParams(state, '_h_folders')
		const url = new URL(`http://x/admin/collections/folders?${params}`)
		expect(browseStateFromURL(url, '_h_folders')).toEqual(state)
	})

	it('reads a missing or "null" parent as the root', () => {
		expect(browseStateFromURL(new URL('http://x/?view=hierarchy'), '_h_folders')).toEqual({
			parentId: null,
			search: '',
		})
		expect(browseStateFromURL(new URL('http://x/?_h_folders=null'), '_h_folders').parentId).toBe(
			null
		)
	})
})
