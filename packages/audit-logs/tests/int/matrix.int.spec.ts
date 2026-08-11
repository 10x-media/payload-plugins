import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import {
	posts,
	readLogs,
	seedUser,
	siteSettings,
	TEST_EMAIL,
	TEST_PASSWORD,
	tags,
	users,
} from './fixtures'

/**
 * The rest of the suite runs on Mongo. This one runs the same write path on both
 * adapters, because that is where they differ: `changedPaths` is a hasMany text field,
 * which Postgres stores in a separate `_texts` table with a row per value, while
 * `diff` and `snapshot` are JSON columns.
 */
describeForDb('auditLogs cross-db', {}, (db) => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					posts: {
						auditFields: true,
						auditLog: { snapshotOnCreate: true, snapshotOnDelete: true },
					},
					users: { auth: true },
				},
				globals: { 'site-settings': true },
				logs: { group: true },
			}),
			db,
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

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('stores a create entry with its snapshot', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Cross-db', views: 1 },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.operation).toBe('create')
		expect(log?.snapshot?.title).toBe('Cross-db')
		expect(log?.user).toBeTruthy()
	})

	it('round-trips changedPaths and diff on update', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Before', views: 1, seo: { title: 'One' } },
			req,
		})
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'After', views: 2, seo: { title: 'Two' } },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		// Three values in one hasMany field, which is three rows in a side table on Postgres.
		expect(update?.changedPaths?.sort()).toEqual(['seo.title', 'title', 'views'])
		expect(update?.diff?.title).toEqual({ before: 'Before', after: 'After' })
		expect(update?.diff?.['seo.title']).toEqual({ before: 'One', after: 'Two' })
	})

	it('filters on changedPaths through the index', async () => {
		const found = await readLogs(booted.payload, { changedPaths: { contains: 'seo.title' } })

		expect(found.length).toBeGreaterThan(0)
		expect(found.every((l) => l.changedPaths?.includes('seo.title'))).toBe(true)
	})

	it('stores a delete entry with its snapshot', async () => {
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'Doomed' }, req })
		await booted.payload.delete({ collection: 'posts', id: doc.id, req })

		const del = (await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })).find(
			(l) => l.operation === 'delete'
		)

		expect(del?.snapshot?.title).toBe('Doomed')
	})

	it('stores a global entry', async () => {
		await booted.payload.updateGlobal({
			slug: 'site-settings',
			data: { siteName: 'Cross-db' },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: 'site-settings' } })

		expect(log?.relationTo).toBe('__global__')
	})

	it('stores an auth entry', async () => {
		await booted.payload.login({
			collection: 'users',
			data: { email: TEST_EMAIL, password: TEST_PASSWORD },
		})

		const logs = await readLogs(booted.payload, { operation: { equals: 'auth' } })

		expect(logs.map((l) => l.eventType)).toContain('login')
	})

	it('stores the group from req.context', async () => {
		const groupedReq = { ...req, context: { auditGroup: 'batch-1' } } as unknown as PayloadRequest
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Grouped' },
			req: groupedReq,
		})

		expect(await readLogs(booted.payload, { group: { equals: 'batch-1' } })).toHaveLength(1)
	})
})
