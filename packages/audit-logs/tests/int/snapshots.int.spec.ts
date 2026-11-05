import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, tags, users } from './fixtures'

describe('snapshots', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	let userId: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					posts: { auditLog: { snapshotOnCreate: true, snapshotOnDelete: true } },
					tags: { auditLog: true },
				},
				anonymize: {
					posts: ({ path, redacted, value }) => (path === 'secret' ? redacted : value),
				},
			}),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				userId = String(user.id)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores the created document instead of a field-by-field diff', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Snapshotted', views: 3 },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.snapshot?.title).toBe('Snapshotted')
		expect(log?.snapshot?.views).toBe(3)
		expect(log?.diff ?? null).toBeNull()
	})

	// Payload adds `createdBy` / `updatedBy` while it sanitizes, after the plugin ran, and
	// hands hooks the populated user. Only the reference may reach the log.
	it('stores core authorship as references, not the populated user', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Authored' },
			req,
		})
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'Reauthored' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		const created = logs.find((l) => l.operation === 'create')
		const updated = logs.find((l) => l.operation === 'update')

		expect(created?.snapshot?.createdBy).toEqual({ relationTo: 'users', value: userId })
		expect(created?.snapshot?.updatedBy).toEqual({ relationTo: 'users', value: userId })
		expect(JSON.stringify(logs)).not.toContain('audit@example.com')
		expect(updated?.changedPaths).toEqual(['title'])
	})

	it('redacts anonymized fields inside the snapshot', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Sensitive', secret: 'do-not-store' },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.snapshot?.title).toBe('Sensitive')
		expect(log?.snapshot?.secret).toBe('__REDACTED__')
	})

	it('stores the removed document on delete', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Recoverable' },
			req,
		})
		await booted.payload.delete({ collection: 'posts', id: doc.id, req })

		const del = (await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })).find(
			(l) => l.operation === 'delete'
		)

		expect(del?.snapshot?.title).toBe('Recoverable')
	})

	it('writes no snapshot for a collection that did not ask for one', async () => {
		const tag = await booted.payload.create({ collection: 'tags', data: { name: 'plain' }, req })

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(tag.id) } })

		expect(log?.operation).toBe('create')
		expect(log?.snapshot ?? null).toBeNull()
	})
})
