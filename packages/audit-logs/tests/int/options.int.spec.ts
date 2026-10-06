import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { pages, posts, readLogs, seedUser, tags, users } from './fixtures'

describe('per-collection options', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	const skipped: string[] = []

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					// Updates only: creates and deletes are not interesting for this collection.
					posts: { auditLog: { operations: ['update'] } },
					pages: { auditLog: { drafts: 'ignore' } },
					tags: {
						auditLog: {
							shouldLog: ({ changedPaths }) => {
								const decided = !changedPaths.includes('name')
								if (!decided) skipped.push(changedPaths.join(','))
								return decided
							},
						},
					},
				},
			}),
			db: 'mongo',
			collections: [posts, pages, tags, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('logs only the operations listed', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Only updates' },
			req,
		})
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'Changed' },
			req,
		})
		await booted.payload.delete({ collection: 'posts', id: doc.id, req })

		const logs = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['update'])
	})

	it('skips draft updates and logs the publish', async () => {
		// A create is always logged, draft or not: the document coming into existence
		// is a real event. Only subsequent draft saves are the noise `ignore` removes.
		const page = await booted.payload.create({
			collection: 'pages',
			data: { title: 'Draft one' },
			draft: true,
			req,
		})
		let logs = await readLogs(booted.payload, { documentId: { equals: String(page.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create'])

		await booted.payload.update({
			collection: 'pages',
			id: page.id,
			data: { title: 'Draft two' },
			draft: true,
			req,
		})
		logs = await readLogs(booted.payload, { documentId: { equals: String(page.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create'])

		await booted.payload.update({
			collection: 'pages',
			id: page.id,
			data: { title: 'Published', _status: 'published' },
			req,
		})
		logs = await readLogs(booted.payload, { documentId: { equals: String(page.id) } })
		expect(logs.map((l) => l.operation)).toEqual(['create', 'update'])
	})

	it('honours a shouldLog that returns false', async () => {
		const tag = await booted.payload.create({ collection: 'tags', data: { name: 'a' }, req })
		await booted.payload.update({
			collection: 'tags',
			id: tag.id,
			data: { name: 'b' },
			req,
		})

		const logs = await readLogs(booted.payload, { documentId: { equals: String(tag.id) } })
		expect(logs.filter((l) => l.operation === 'update')).toHaveLength(0)
		expect(skipped).toContain('name')
	})

	it('leaves a collection that was never listed untouched', async () => {
		const before = await readLogs(booted.payload)
		await booted.payload.create({
			collection: 'users',
			data: { email: 'nolog@example.com', password: 'password' },
			req,
		})
		const after = await readLogs(booted.payload)

		expect(after.filter((l) => l.relationTo === 'users' && l.operation === 'create')).toHaveLength(
			0
		)
		expect(after.length).toBe(before.length)
	})
})

describe('anonymize and group', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: { posts: { auditLog: true } },
				anonymize: {
					posts: ({ path, redacted, value }) => (path === 'secret' ? redacted : value),
				},
				logs: { group: { contextKey: 'importRun' } },
			}),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('redacts the value but keeps the path', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Secretive', secret: 'one' },
			req,
		})
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { secret: 'two' },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		expect(update?.changedPaths).toEqual(['secret'])
		expect(update?.diff?.secret?.after).toBe('__REDACTED__')
		expect(update?.diff?.secret?.before).toBe('__REDACTED__')
	})

	it('stamps the group from the configured context key', async () => {
		const groupedReq = { ...req, context: { importRun: 'run-42' } } as unknown as PayloadRequest
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Grouped' },
			req: groupedReq,
		})

		const logs = await readLogs(booted.payload, { group: { equals: 'run-42' } })
		expect(logs).toHaveLength(1)
	})

	it('leaves the group empty when the context key is absent', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Ungrouped' },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		expect(log?.group ?? null).toBeNull()
	})
})
