import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, createFolderField, type Where } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	acceptsWhere,
	andWhere,
	childrenWhere,
	filedInWhere,
	notChosenWhere,
} from '../../src/folder/hierarchy'
import { folderPicker } from '../../src/index'

const FIELD = '_h_folders'

const folders: CollectionConfig = {
	slug: 'folders',
	admin: { useAsTitle: 'name' },
	folders: { collectionSpecific: true },
	fields: [{ name: 'name', type: 'text' }],
}

const media: CollectionConfig = {
	slug: 'media',
	admin: { useAsTitle: 'title' },
	fields: [{ name: 'title', type: 'text' }, createFolderField({ relationTo: 'folders' })],
}

const files: CollectionConfig = {
	slug: 'files',
	fields: [{ name: 'title', type: 'text' }, createFolderField({ relationTo: 'folders' })],
}

/**
 * The folder tab reads over REST with the `where` constraints from `src/folder/hierarchy.ts`.
 * Each adapter translates them on its own (a null relationship, a hasMany select, `not_in` on
 * ids), so they run here against every database rather than only in the Mongo e2e.
 */
describeForDb('folderPicker queries', {}, (db) => {
	let booted: BootedPayload
	const ids: Record<string, number | string> = {}
	const id = (name: string): number | string => {
		const value = ids[name]
		if (value === undefined) {
			throw new Error(`fixture ${name} was not created`)
		}
		return value
	}

	const names = async (collection: 'folders' | 'media', where?: Where) => {
		const result = await booted.payload.find({
			collection,
			depth: 0,
			overrideAccess: true,
			sort: collection === 'folders' ? 'name' : 'title',
			where,
		})
		return result.docs.map((doc) => (doc as { name?: string; title?: string }).name ?? doc.title)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [folders, media, files],
			db,
			plugin: folderPicker({}),
		})
		const { payload } = booted
		const folder = async (name: string, hierarchyType?: string[], parent?: number | string) =>
			(
				await payload.create({
					collection: 'folders',
					data: { [FIELD]: parent ?? null, hierarchyType, name },
					overrideAccess: true,
				})
			).id
		ids.brand = await folder('Brand', ['media'])
		ids.marketing = await folder('Marketing', ['media'])
		ids.team = await folder('Team', ['media'], id('marketing'))
		ids.documents = await folder('Documents', ['files'])
		ids.shared = await folder('Shared')

		const upload = async (title: string, parent?: number | string) =>
			(
				await payload.create({
					collection: 'media',
					data: { [FIELD]: parent ?? null, title },
					overrideAccess: true,
				})
			).id
		ids.logo = await upload('logo', id('brand'))
		ids.mark = await upload('mark', id('brand'))
		ids.anna = await upload('anna', id('team'))
		ids.loose = await upload('loose')
	})

	afterAll(async () => {
		await booted?.stop()
	})

	it(`lists root folders on ${db}`, async () => {
		expect(await names('folders', childrenWhere(FIELD, null))).toEqual([
			'Brand',
			'Documents',
			'Marketing',
			'Shared',
		])
	})

	it(`lists a folder's subfolders on ${db}`, async () => {
		expect(await names('folders', childrenWhere(FIELD, id('marketing')))).toEqual(['Team'])
	})

	it(`hides folders that do not accept the collection on ${db}`, async () => {
		const where = andWhere(
			childrenWhere(FIELD, null),
			acceptsWhere('hierarchyType', ['media'], ['files', 'media'])
		)
		expect(await names('folders', where)).toEqual(['Brand', 'Marketing', 'Shared'])
	})

	it(`lists unfiled documents at the root on ${db}`, async () => {
		expect(await names('media', filedInWhere(FIELD, null))).toEqual(['loose'])
	})

	it(`lists a folder's documents on ${db}`, async () => {
		expect(await names('media', filedInWhere(FIELD, id('brand')))).toEqual(['logo', 'mark'])
	})

	it(`hides documents the field already holds on ${db}`, async () => {
		const where = andWhere(filedInWhere(FIELD, id('brand')), notChosenWhere([String(id('logo'))]))
		expect(await names('media', where)).toEqual(['mark'])
	})
})
