import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

import { ContentLockedError, contentLock, isContentLocked } from '../../src/index'

const LOCKS = 'content-locks'
const FOLDERS = 'payload-folders'

const documents: CollectionConfig = {
	slug: 'documents',
	folders: true,
	fields: [{ name: 'title', type: 'text' }],
}

describeForDb('content-lock and the folders collection', {}, (db) => {
	let booted: BootedPayload

	const payload = () => booted.payload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [documents],
			plugin: contentLock({
				groups: [{ key: 'library', label: 'Library', collections: ['documents', FOLDERS] }],
				individualSelection: true,
			}),
		})
	})

	afterEach(async () => {
		await payload().delete({
			collection: LOCKS,
			where: { id: { exists: true } },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('freezes the folders collection through a group', async () => {
		await payload().create({
			collection: LOCKS,
			data: { title: 'Library freeze', lockEverything: false, groups: ['library'] },
			overrideAccess: true,
		})
		expect(await isContentLocked(payload(), { collection: FOLDERS })).toBe(true)
		await expect(
			payload().create({ collection: FOLDERS, data: { name: 'Reports' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
	})

	it('offers the folders collection for individual selection', () => {
		const field = payload().collections[LOCKS]?.config.flattenedFields.find(
			(candidate) => candidate.name === 'collections'
		)
		const component = field?.admin?.components?.Field as
			| { clientProps?: { slugs?: string[] } }
			| undefined
		expect(component?.clientProps?.slugs).toContain(FOLDERS)
	})
})
