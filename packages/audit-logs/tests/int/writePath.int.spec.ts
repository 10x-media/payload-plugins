import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, tags, users } from './fixtures'

const boot = (options: Parameters<typeof auditLogs>[0], onReq?: (req: PayloadRequest) => void) =>
	bootPayload({
		plugin: auditLogs(options),
		db: 'mongo',
		collections: [posts, tags, users],
		seed: async (payload) => {
			const user = await seedUser(payload)
			onReq?.({ user: { ...user, collection: 'users' } } as unknown as PayloadRequest)
		},
	})

const logCollection = (booted: BootedPayload): CollectionConfig | undefined =>
	booted.payload.config.collections.find((c) => c.slug === 'audit-logs')

/**
 * Records every collection that goes through the operation pipeline. The direct path
 * never reaches it, which is the only way to tell the two apart from the outside: both
 * produce the same row.
 */
const spyOnPipeline = (booted: BootedPayload): string[] => {
	const calls: string[] = []
	const original = booted.payload.create.bind(booted.payload)
	booted.payload.create = ((args: Parameters<typeof original>[0]) => {
		calls.push(args.collection as string)
		return original(args)
	}) as typeof booted.payload.create
	return calls
}

/**
 * Entries are written straight through the database adapter, skipping Payload's operation
 * pipeline. These pin down what that has to keep producing, and the one case where the
 * plugin must fall back to the pipeline instead.
 */
describe('direct write', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await boot(
			{
				collections: {
					posts: { auditLog: { snapshotOnCreate: true, snapshotOnDelete: true } },
					users: { auth: true },
				},
				logs: { group: true },
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('produces a complete entry without the pipeline', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Direct', views: 1 },
			req,
		})

		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.operation).toBe('create')
		expect(log?.relationTo).toBe('posts')
		expect(log?.user).toBeTruthy()
		expect(log?.payloadAPI).toBeTruthy()
		expect(log?.snapshot?.title).toBe('Direct')
	})

	it('lets the adapter default the timestamps', async () => {
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'Timed' }, req })

		const [log] = (
			await booted.payload.find({
				collection: 'audit-logs',
				where: { documentId: { equals: String(doc.id) } },
				overrideAccess: true,
			})
		).docs as unknown as { createdAt?: string; updatedAt?: string }[]

		// Neither is set by the plugin. The pipeline used to fill them in.
		expect(Date.parse(log?.createdAt ?? '')).not.toBeNaN()
		expect(Date.parse(log?.updatedAt ?? '')).not.toBeNaN()
	})

	it('still fills the hasMany field the diff writes', async () => {
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'A' }, req })
		await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'B', views: 9 },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		expect(update?.changedPaths?.sort()).toEqual(['title', 'views'])
		expect(await readLogs(booted.payload, { changedPaths: { contains: 'views' } })).toHaveLength(1)
	})

	it('still resolves the user relationship well enough to query it', async () => {
		const userId = String((req.user as { id: unknown }).id)

		expect((await readLogs(booted.payload, { user: { equals: userId } })).length).toBeGreaterThan(0)
	})

	it('writes auth entries the same way', async () => {
		await booted.payload.login({
			collection: 'users',
			data: { email: 'audit@example.com', password: 'password' },
		})

		expect(await readLogs(booted.payload, { operation: { equals: 'auth' } })).toHaveLength(1)
	})

	it('never reaches the operation pipeline', async () => {
		const calls = spyOnPipeline(booted)

		await booted.payload.create({ collection: 'posts', data: { title: 'Spied' }, req })

		expect(calls).toEqual(['posts'])
	})
})

describe('an override without hooks', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await boot(
			{
				collections: { posts: { auditLog: true } },
				logs: {
					override: (collection) => ({
						...collection,
						fields: [...collection.fields, { name: 'source', type: 'text' }],
					}),
				},
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps writing entries', async () => {
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'Field' }, req })

		expect(await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })).toHaveLength(
			1
		)
	})

	it('keeps the added field', () => {
		const names = (logCollection(booted)?.fields ?? []).map((f) => ('name' in f ? f.name : ''))

		expect(names).toContain('source')
	})
})

describe('an override that attaches hooks', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	const seen: string[] = []

	beforeAll(async () => {
		booted = await boot(
			{
				collections: { posts: { auditLog: true } },
				logs: {
					override: (collection) => ({
						...collection,
						hooks: {
							...collection.hooks,
							afterChange: [
								...(collection.hooks?.afterChange ?? []),
								({ doc }) => {
									seen.push(String((doc as { operation?: unknown }).operation))
									return doc
								},
							],
						},
					}),
				},
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('falls back to the pipeline so the hook fires', async () => {
		const calls = spyOnPipeline(booted)

		await booted.payload.create({ collection: 'posts', data: { title: 'Hooked' }, req })

		// A direct write would bypass this entirely and `seen` would stay empty.
		expect(seen).toEqual(['create'])
		expect(calls).toEqual(['posts', 'audit-logs'])
	})

	it('still writes the entry itself', async () => {
		expect((await readLogs(booted.payload)).length).toBeGreaterThan(0)
	})
})
