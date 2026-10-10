import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { Access, CollectionConfig, CollectionSlug, TypedUser } from 'payload'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import type { DeliveryMode } from '../../src/options'
import { LOCAL_SINK } from './localSink'

type Who = { id?: number | string; role?: string; tenant?: string } | null | undefined

const tenantRead: Access = ({ req }) => {
	const user = req.user as Who
	if (!user) {
		return false
	}
	return user.role === 'admin' ? true : { tenant: { equals: user.tenant } }
}

const tenanted = (slug: string, extra: Partial<CollectionConfig> = {}): CollectionConfig => ({
	slug,
	access: { read: tenantRead },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text' },
	],
	...extra,
})

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	access: { read: () => true },
	fields: [
		{ name: 'role', type: 'text' },
		{ name: 'tenant', type: 'text' },
	],
}

/** A field only a request carrying a context flag may read, the way an internal job might. */
const posts = tenanted('posts', {
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text' },
		{
			name: 'contextNote',
			type: 'text',
			access: { read: ({ req }) => req.context?.privileged === true },
		},
	],
})

/** Read access that throws for a tenant user instead of returning false. */
const fragile = tenanted('fragile', {
	access: {
		read: ({ req }) => {
			if ((req.user as Who)?.role === 'member') {
				throw new Error('access blew up')
			}
			return Boolean(req.user)
		},
	},
})

const articles = tenanted('articles', { versions: { drafts: true } })
const notes = tenanted('notes')

const allow = () => true

let sink: Server
let sinkUrl: string
let hits: { path: string; body: Record<string, unknown> }[] = []
/** Every subscription `owner.resolve` was asked about, by name. */
let resolved: string[] = []

const boot = (mode: DeliveryMode) =>
	bootPayload({
		db: 'mongo',
		collections: [users, posts, fragile, articles, notes],
		plugin: webhooks({
			collections: {
				posts: { scope: ({ doc }) => ({ tenant: { equals: doc.tenant } }) },
				fragile: true,
				articles: true,
				// The subscriptions collection has no such field, so the query this builds is invalid.
				notes: { scope: () => ({ noSuchField: { equals: 'x' } }) },
			},
			subscriptions: [{ id: 'ops', url: `${sinkUrl}/ops`, events: ['fragile.created'] }],
			delivery: { mode, retries: 0, ...LOCAL_SINK },
			enforceOwnerAccess: true,
			owner: {
				resolve: async ({ subscription, req }) => {
					resolved.push(String(subscription.record.name))
					const ownerId = subscription.record.owner
					if (typeof ownerId !== 'string' && typeof ownerId !== 'number') {
						return null
					}
					const user = await req.payload.findByID({
						collection: 'users',
						id: ownerId,
						depth: 0,
						overrideAccess: true,
						disableErrors: true,
						req,
					})
					return user ? { user: { ...user, collection: 'users' } } : null
				},
			},
			subscriptionsCollection: {
				overrides: {
					access: { read: allow, create: allow, update: allow, delete: allow },
					fields: ({ defaultFields }) => [
						...defaultFields,
						{ name: 'owner', type: 'relationship', relationTo: 'users' },
						{ name: 'tenant', type: 'text', index: true },
					],
				},
			},
			deliveriesLog: { overrides: { access: { read: allow, delete: allow } } },
		}),
	})

const startSink = async () => {
	sink = createServer((request, res) => {
		let raw = ''
		request.on('data', (c) => {
			raw += c
		})
		request.on('end', () => {
			hits.push({ path: request.url ?? '', body: JSON.parse(raw || '{}') })
			res.writeHead(200)
			res.end('ok')
		})
	})
	await new Promise<void>((r) => sink.listen(0, r))
	const addr = sink.address()
	if (addr === null || typeof addr === 'string') {
		throw new Error('no port')
	}
	sinkUrl = `http://127.0.0.1:${addr.port}`
}

const fixture = (booted: () => BootedPayload) => {
	const member = async (tenant: string) =>
		({
			...(await booted().payload.create({
				collection: 'users',
				data: { email: `${tenant}@test.dev`, password: 'test1234', role: 'member', tenant },
				overrideAccess: true,
			})),
			collection: 'users',
		}) as unknown as TypedUser

	const subscribe = async (name: string, owner: TypedUser, events: string[]) =>
		String(
			(
				await booted().payload.create({
					collection: 'webhook-subscriptions',
					data: {
						name,
						url: `${sinkUrl}/${name}`,
						enabled: true,
						events,
						owner: owner.id,
						tenant: (owner as Who)?.tenant,
					},
					overrideAccess: true,
				})
			).id
		)

	/** Whether a document is really in the database, read outside any request. */
	const stored = async (collection: string, id: number | string): Promise<boolean> =>
		(
			await booted().payload.count({
				collection: collection as CollectionSlug,
				where: { id: { equals: id } },
				overrideAccess: true,
			})
		).totalDocs === 1

	return { member, subscribe, stored }
}

const pathsHit = () => hits.map((h) => h.path).sort()
const dataAt = (path: string) =>
	hits.find((h) => h.path === path)?.body.data as Record<string, unknown>

describe('owner access, the paths around the happy one (inline)', () => {
	let booted: BootedPayload
	let memberA: TypedUser
	let memberB: TypedUser
	const { member, subscribe, stored } = fixture(() => booted)

	beforeAll(async () => {
		await startSink()
		booted = await boot('inline')
		memberA = await member('a')
		memberB = await member('b')
		await subscribe('pa', memberA, ['posts.created', 'posts.deleted'])
		await subscribe('pb', memberB, ['posts.created', 'posts.deleted'])
		await subscribe('aa', memberA, ['articles.created', 'articles.updated'])
		await subscribe('na', memberA, ['notes.created'])
		// Past the save guard, which would refuse it: the owner cannot read `fragile` at all.
		await booted.payload.db.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'fa',
				url: `${sinkUrl}/fa`,
				enabled: true,
				events: ['fragile.created'],
				owner: memberA.id,
				tenant: 'a',
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	beforeEach(() => {
		hits = []
		resolved = []
	})

	/**
	 * Payload rolls back the transaction of an operation that throws on it. The owner read runs on
	 * the write's transaction, so a throw there must not be allowed to reach it: the write would
	 * vanish while the API reported success.
	 */
	it('keeps the write when read access throws for the owner', async () => {
		const doc = await booted.payload.create({
			collection: 'fragile',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		await expect(stored('fragile', doc.id)).resolves.toBe(true)
		expect(pathsHit()).toEqual(['/ops'])
	})

	it('keeps the write, and still delivers, when scope returns a query the collection cannot run', async () => {
		const doc = await booted.payload.create({
			collection: 'notes',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		await expect(stored('notes', doc.id)).resolves.toBe(true)
		expect(pathsHit()).toEqual(['/na'])
	})

	/** The owner is not the writer, so nothing the writer's request was flagged with is theirs. */
	it('does not lend the owner the request context of the writer', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a', contextNote: 'for the privileged' },
			context: { privileged: true },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/pa'])
		expect(dataAt('/pa')).not.toHaveProperty('contextNote')
	})

	/** A draft save does not touch the main document, so the owner has to be read the draft. */
	it('sends the owner the draft that was saved, not the last published version', async () => {
		const article = await booted.payload.create({
			collection: 'articles',
			data: { title: 'one', tenant: 'a', _status: 'published' },
			overrideAccess: true,
		})
		hits = []
		await booted.payload.update({
			collection: 'articles',
			id: article.id,
			data: { title: 'two' },
			draft: true,
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/aa'])
		expect(dataAt('/aa').title).toBe('two')
		expect(dataAt('/aa')._status).toBe('draft')
	})

	it('applies scope before a delete as well, so other tenants are not even asked about', async () => {
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		hits = []
		resolved = []
		await booted.payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })
		expect(pathsHit()).toEqual(['/pa'])
		expect(resolved).toEqual(['pa'])
	})

	it('clears each document of a bulk delete on its own', async () => {
		for (const tenant of ['a', 'a', 'b']) {
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'bulk', tenant },
				overrideAccess: true,
			})
		}
		hits = []
		await booted.payload.delete({
			collection: 'posts',
			where: { title: { equals: 'bulk' } },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/pa', '/pa', '/pb'])
		expect(hits.every((h) => h.body.event === 'posts.deleted')).toBe(true)
	})

	/** No user on the request means trusted server code only when it came through the Local API. */
	it('does not take an anonymous REST caller for trusted server code', async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://localhost:3000/api/webhook-subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'anon',
					url: `${sinkUrl}/anon`,
					events: ['posts.created'],
					owner: memberA.id,
				}),
			}),
		})
		expect(res.status).toBe(403)
	})
})

describe('owner access in queue mode', () => {
	let booted: BootedPayload
	let memberA: TypedUser
	let memberB: TypedUser
	let subscription: string
	const { member, subscribe } = fixture(() => booted)

	beforeAll(async () => {
		await startSink()
		booted = await boot('queue')
		memberA = await member('a')
		memberB = await member('b')
		subscription = await subscribe('qa', memberA, ['posts.created'])
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	beforeEach(() => {
		hits = []
	})

	it('queues the view of the owner and delivers it when the job runs', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'queued', tenant: 'a', contextNote: 'for the privileged' },
			context: { privileged: true },
			overrideAccess: true,
		})
		expect(hits).toHaveLength(0)
		await booted.payload.jobs.run()
		expect(pathsHit()).toEqual(['/qa'])
		expect(dataAt('/qa').title).toBe('queued')
		expect(dataAt('/qa')).not.toHaveProperty('contextNote')
	})

	/**
	 * The body was built for whoever owned the subscription when the write happened. A job that
	 * runs, or retries, after the subscription was handed to someone else would post it to them.
	 */
	it('does not deliver a queued body once the subscription acts as someone else', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'for a only', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: subscription,
			data: { owner: memberB.id, tenant: 'b', url: `${sinkUrl}/qb` },
			overrideAccess: true,
		})
		await booted.payload.jobs.run()
		expect(hits).toHaveLength(0)
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
			sort: '-createdAt',
			limit: 1,
		})
		expect(rows.docs[0]?.status).toBe('dead')
		expect(String(rows.docs[0]?.error)).toMatch(/changed owner/)
	})
})
