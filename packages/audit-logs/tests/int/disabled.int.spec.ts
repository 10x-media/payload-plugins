import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, tags, users } from './fixtures'

/**
 * `disabled` is deliberately weaker here than in the sibling plugins: the schema
 * must survive so the next migration does not drop the collection and the audit
 * columns. Only the behaviour is switched off.
 */
describe('disabled plugin', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				disabled: true,
				collections: { posts: { auditFields: true, auditLog: true } },
			}),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				await seedUser(payload)
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps the audit-logs collection registered', () => {
		expect(booted.payload.collections['audit-logs']).toBeDefined()
	})

	it('keeps the audit fields on the audited collection', () => {
		const names = (booted.payload.collections.posts?.config.fields ?? []).map((f) =>
			'name' in f ? f.name : undefined
		)

		expect(names).toContain('createdBy')
		expect(names).toContain('lastModifiedBy')
	})

	it('writes no entries', async () => {
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'Quiet' } })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'Still quiet' },
		})
		await booted.payload.delete({ collection: 'posts', id: doc.id })

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})
})
