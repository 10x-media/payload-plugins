import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { type AuditLogDoc, posts, readLogs, seedUser, siteSettings, tags, users } from './fixtures'

describe('audit log entries', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					posts: {
						auditLog: { excludeFields: ['internalNotes'] },
					},
				},
				globals: { 'site-settings': true },
			}),
			db: 'mongo',
			collections: [posts, tags, users],
			configOverrides: { globals: [siteSettings] },
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: 'posts', data, req })

	it('writes one entry per create, with no diff', async () => {
		const doc = await create({ title: 'First' })
		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(logs).toHaveLength(1)
		expect(logs[0]?.operation).toBe('create')
		expect(logs[0]?.relationTo).toBe('posts')
		expect(logs[0]?.changedPaths ?? []).toEqual([])
	})

	it('records the acting user on the entry', async () => {
		const doc = await create({ title: 'Attributed' })
		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.user).toBeTruthy()
	})

	it('diffs only the fields that changed on update', async () => {
		const doc = await create({ title: 'Before', views: 1 })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'After' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		const update = logs.find((l) => l.operation === 'update')

		expect(update?.changedPaths).toEqual(['title'])
		expect(update?.diff?.title).toEqual({ before: 'Before', after: 'After' })
	})

	it('writes dot-notated paths for group fields', async () => {
		const doc = await create({ title: 'Grouped', seo: { title: 'One' } })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { seo: { title: 'Two' } },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		expect(update?.changedPaths).toEqual(['seo.title'])
	})

	it('skips the update entirely when nothing outside excludeFields changed', async () => {
		const doc = await create({ title: 'Quiet', internalNotes: 'a' })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { internalNotes: 'b' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create'])
	})

	it('writes no entry when an update changes nothing', async () => {
		const doc = await create({ title: 'Same' })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'Same' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create'])
	})

	it('logs deletes and keeps the entry after the document is gone', async () => {
		const doc = await create({ title: 'Doomed' })
		await booted.payload.delete({ collection: 'posts', id: doc.id, req })

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create', 'delete'])
	})

	it('normalizes relationships to ids rather than populated documents', async () => {
		const tag = await booted.payload.create({ collection: 'tags', data: { name: 'rel' }, req })
		const doc = await create({ title: 'Related' })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { tags: [tag.id] },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		expect(update?.diff?.tags?.after).toEqual([String(tag.id)])
	})

	it('records array reordering as a single __order__ path', async () => {
		const doc = await create({
			title: 'Ordered',
			sections: [{ heading: 'A' }, { heading: 'B' }],
		})
		const seeded = await booted.payload.findByID({ collection: 'posts', id: doc.id })
		const sections = (seeded.sections ?? []) as { heading?: string; id?: string }[]

		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { sections: [...sections].reverse() },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		expect(update?.changedPaths).toContain('sections.__order__')
	})

	it('stores globals under the __global__ sentinel', async () => {
		await booted.payload.updateGlobal({
			slug: 'site-settings',
			data: { siteName: 'Audited' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: 'site-settings' } })
		const entry = logs.at(-1) as AuditLogDoc | undefined

		expect(entry?.relationTo).toBe('__global__')
		expect(entry?.operation).toBe('update')
	})

	it('never logs its own collection', async () => {
		const before = await readLogs(booted.payload)
		await booted.payload.update({
			collection: 'audit-logs',
			id: String(before[0]?.id),
			data: { eventType: 'touched' },
			overrideAccess: true,
		})
		const after = await readLogs(booted.payload)

		expect(after.filter((l) => l.relationTo === 'audit-logs')).toHaveLength(0)
		expect(after).toHaveLength(before.length)
	})
})
