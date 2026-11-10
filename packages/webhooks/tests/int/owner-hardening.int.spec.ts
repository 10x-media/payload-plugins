import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { Access, CollectionConfig, CollectionSlug, User } from 'payload'
import { createPayloadRequest, handleEndpoints } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * Fields only a request carrying a context flag or a header may read, the way an internal job or
 * a privileged client might.
 */
const posts = tenanted('posts', {
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text' },
		{
			name: 'contextNote',
			type: 'text',
			access: { read: ({ req }) => req.context?.privileged === true },
		},
		{
			name: 'headerNote',
			type: 'text',
			access: { read: ({ req }) => req.headers?.get('x-privileged') === '1' },
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
/** The `x-tenant` header `owner.resolve` saw, once per call. */
let resolveHeaders: (string | null)[] = []
/** Whose view each `transform` call was handed, by owner id. */
let transformedFor: (string | null)[] = []
/** The `x-tenant` header `owner.canActAs` saw, once per call. */
let canActAsHeaders: (string | null)[] = []

const boot = (mode: DeliveryMode) =>
	bootPayload({
		db: 'mongo',
		collections: [users, posts, fragile, articles, notes],
		plugin: webhooks({
			collections: {
				posts: {
					scope: ({ doc }) => ({ tenant: { equals: doc.tenant } }),
					transform: ({ doc, owner }) => {
						transformedFor.push(owner ? String(owner.user.id) : null)
						return doc
					},
				},
				fragile: true,
				articles: true,
				// The subscriptions collection has no such field, so the query this builds is invalid.
				notes: { scope: () => ({ noSuchField: { equals: 'x' } }) },
			},
			subscriptions: [
				{ id: 'ops', url: `${sinkUrl}/ops`, events: ['fragile.created', 'notes.deleted'] },
			],
			delivery: { mode, retries: 0, ...LOCAL_SINK },
			enforceOwnerAccess: true,
			owner: {
				resolve: async ({ subscription, req }) => {
					resolved.push(String(subscription.record.name))
					resolveHeaders.push(req.headers.get('x-tenant'))
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
				// The default rule, a user acting as themselves, plus a record of the headers it saw.
				canActAs: ({ owner, req }) => {
					canActAsHeaders.push(req.headers.get('x-tenant'))
					return Boolean(req.user && !owner.global && String(owner.user.id) === String(req.user.id))
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
		}) as unknown as User

	const subscribe = async (name: string, owner: User, events: string[]) =>
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
	let memberA: User
	let memberB: User
	const { member, subscribe, stored } = fixture(() => booted)

	beforeAll(async () => {
		await startSink()
		booted = await boot('inline')
		memberA = await member('a')
		memberB = await member('b')
		await subscribe('pa', memberA, ['posts.created', 'posts.updated', 'posts.deleted'])
		await subscribe('pb', memberB, ['posts.created', 'posts.updated', 'posts.deleted'])
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
		resolveHeaders = []
		transformedFor = []
		canActAsHeaders = []
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

	/**
	 * `resolve` is a question about the caller's application, which may keep flags in a cookie, so
	 * it sees the writer's headers. The read made as the owner is not the writer's, so it does not.
	 */
	it('hands owner.resolve the headers of the writer, and reads as the owner without them', async () => {
		const req = await createPayloadRequest({
			payload: booted.payload,
			req: { headers: new Headers({ 'x-tenant': 'a', 'x-privileged': '1' }) },
		})
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a', headerNote: 'for privileged clients' },
			overrideAccess: true,
			req,
		})
		expect(pathsHit()).toEqual(['/pa'])
		expect(resolveHeaders).toContain('a')
		expect(dataAt('/pa').title).toBe('x')
		expect(dataAt('/pa')).not.toHaveProperty('headerNote')
	})

	/** Whether the caller may name an owner is a question about the caller, cookies included. */
	it('hands owner.canActAs the headers of the one saving the subscription', async () => {
		const req = await createPayloadRequest({
			payload: booted.payload,
			req: { headers: new Headers({ 'x-tenant': 'a' }) },
			user: memberA,
		})
		const saved = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'self',
				url: `${sinkUrl}/self`,
				enabled: true,
				events: ['posts.created'],
				owner: memberA.id,
				tenant: 'z',
			},
			overrideAccess: false,
			user: memberA,
			req,
		})
		expect(canActAsHeaders).toEqual(['a'])
		await booted.payload.delete({
			collection: 'webhook-subscriptions',
			id: saved.id,
			overrideAccess: true,
		})
	})

	/** `req` in a transform is the writer's, so it is told separately whose view it shapes. */
	it('tells transform whose view of the document it is shaping', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'b' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/pb'])
		expect(transformedFor).toEqual([String(memberB.id)])
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

	it('clears each document of a bulk update on its own', async () => {
		for (const tenant of ['a', 'a', 'b']) {
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'bulk-u', tenant },
				overrideAccess: true,
			})
		}
		hits = []
		await booted.payload.update({
			collection: 'posts',
			where: { title: { equals: 'bulk-u' } },
			data: { title: 'changed' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/pa', '/pa', '/pb'])
		expect(hits.every((h) => h.body.event === 'posts.updated')).toBe(true)
		expect(hits.every((h) => (h.body.data as { title?: string }).title === 'changed')).toBe(true)
	})

	/**
	 * The pre-check exists for owner-bound subscriptions. A code subscription is global and needs
	 * none, so a pre-check that fails must not cost it the event.
	 */
	it('still tells a code subscription about a delete whose pre-check failed', async () => {
		const note = await booted.payload.create({
			collection: 'notes',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		hits = []
		const find = booted.payload.find.bind(booted.payload)
		let failed = false
		const spy = vi.spyOn(booted.payload, 'find').mockImplementation(((
			args: Parameters<typeof find>[0]
		) => {
			if (!failed && args.collection === 'notes') {
				failed = true
				return Promise.reject(new Error('the document could not be read'))
			}
			return find(args)
		}) as never)
		try {
			await booted.payload.delete({ collection: 'notes', id: note.id, overrideAccess: true })
		} finally {
			spy.mockRestore()
		}
		expect(failed).toBe(true)
		expect(pathsHit()).toEqual(['/ops'])
	})

	/**
	 * Such a row cannot deliver, and nothing about switching it off, renaming it or rotating its
	 * secret changes that. An operator has to be able to do those without first inventing an owner.
	 */
	it('lets a subscription whose owner is gone still be switched off', async () => {
		const gone = await member('c')
		const id = await subscribe('pc', gone, ['posts.created'])
		await booted.payload.delete({ collection: 'users', id: gone.id, overrideAccess: true })
		const updated = await booted.payload.update({
			collection: 'webhook-subscriptions',
			id,
			data: { enabled: false },
			overrideAccess: true,
		})
		expect(updated.enabled).toBe(false)
	})

	it('lets a subscription be switched off after its owner lost access, and still refuses it more', async () => {
		const demoted = (await booted.payload.create({
			collection: 'users',
			data: { email: 'd@test.dev', password: 'test1234', role: 'admin', tenant: 'd' },
			overrideAccess: true,
		})) as unknown as User
		const id = await subscribe('fd', demoted, ['fragile.created'])
		await booted.payload.update({
			collection: 'users',
			id: demoted.id,
			data: { role: 'member' },
			overrideAccess: true,
		})
		await expect(
			booted.payload.update({
				collection: 'webhook-subscriptions',
				id,
				data: { events: ['fragile.created', 'fragile.deleted'] },
				overrideAccess: true,
			})
		).rejects.toMatchObject({ status: 403 })
		const updated = await booted.payload.update({
			collection: 'webhook-subscriptions',
			id,
			data: { enabled: false },
			overrideAccess: true,
		})
		expect(updated.enabled).toBe(false)
	})

	/**
	 * A job that works through many documents on one request must not keep acting on what an owner
	 * was allowed to read when it started.
	 */
	it('asks about an owner again once the answer has aged, on a request that is reused', async () => {
		const req = await createPayloadRequest({ payload: booted.payload })
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'first', tenant: 'a' },
			overrideAccess: true,
			req,
		})
		expect(pathsHit()).toEqual(['/pa'])
		await booted.payload.update({
			collection: 'users',
			id: memberA.id,
			data: { tenant: 'elsewhere' },
			overrideAccess: true,
		})
		hits = []
		const now = Date.now()
		const clock = vi.spyOn(Date, 'now').mockImplementation(() => now + 60_000)
		try {
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'second', tenant: 'a' },
				overrideAccess: true,
				req,
			})
		} finally {
			clock.mockRestore()
			await booted.payload.update({
				collection: 'users',
				id: memberA.id,
				data: { tenant: 'a' },
				overrideAccess: true,
			})
		}
		expect(pathsHit()).toEqual([])
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
	let memberA: User
	let memberB: User
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
		await booted.payload.jobs.run({ overrideAccess: true })
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
		await booted.payload.jobs.run({ overrideAccess: true })
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

	/**
	 * The body is fixed at the write, so a revoked access has to be asked about again before each
	 * attempt. Otherwise a retry hours later would still send what the owner may no longer read.
	 */
	it('does not deliver a queued body once the owner can no longer read the document', async () => {
		const id = await subscribe('qr', memberA, ['posts.created'])
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'moving', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.update({
			collection: 'posts',
			id: post.id,
			data: { tenant: 'b' },
			overrideAccess: true,
		})
		await booted.payload.jobs.run({ overrideAccess: true })
		expect(hits).toHaveLength(0)
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			where: { subscriptionId: { equals: id } },
			overrideAccess: true,
		})
		expect(rows.docs).toHaveLength(1)
		expect(rows.docs[0]?.documentId).toBe(String(post.id))
		expect(rows.docs[0]?.status).toBe('dead')
		expect(String(rows.docs[0]?.error)).toMatch(/can no longer read this document/)
		await booted.payload.delete({ collection: 'webhook-subscriptions', id, overrideAccess: true })
	})

	/**
	 * A run works through its jobs concurrently on one request whose `context` they share, and the
	 * window onto sealed secrets lives there. Shared, the first task to finish would close it on the
	 * others, and they would refuse to send rather than send unsigned.
	 */
	it('delivers every job of a run, each with its own window onto the sealed secrets', async () => {
		const ids = await Promise.all(
			['qc1', 'qc2', 'qc3'].map((name) => subscribe(name, memberA, ['posts.created']))
		)
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'fanned out', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.jobs.run({ overrideAccess: true })
		expect(pathsHit().filter((p) => p.startsWith('/qc'))).toEqual(['/qc1', '/qc2', '/qc3'])
		for (const id of ids) {
			await booted.payload.delete({ collection: 'webhook-subscriptions', id, overrideAccess: true })
		}
	})

	/** The delete branch has to let a delete through when nothing changed, or it would drop them all. */
	it('delivers a queued delete while the owner can still read the collection', async () => {
		const id = await subscribe('qk', memberA, ['posts.deleted'])
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'going', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })
		await booted.payload.jobs.run({ overrideAccess: true })
		expect(pathsHit()).toEqual(['/qk'])
		await booted.payload.delete({ collection: 'webhook-subscriptions', id, overrideAccess: true })
	})

	/**
	 * A re-read that fails says nothing about access. It is a failed attempt, so the job's retries
	 * apply, rather than a refusal that ends the delivery as if access had been revoked.
	 */
	it('records a check that could not be made as a failed attempt, not as a revoked access', async () => {
		const id = await subscribe('qe', memberA, ['posts.created'])
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'unlucky', tenant: 'a' },
			overrideAccess: true,
		})
		const collection = booted.payload.collections.posts
		if (!collection) {
			throw new Error('the posts collection is not registered')
		}
		const configured = collection.config.access.read
		collection.config.access.read = () => {
			throw new Error('database unavailable')
		}
		try {
			await booted.payload.jobs.run({ overrideAccess: true })
		} finally {
			collection.config.access.read = configured
		}
		expect(hits).toHaveLength(0)
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			where: { subscriptionId: { equals: id } },
			overrideAccess: true,
		})
		expect(rows.docs).toHaveLength(1)
		expect(String(rows.docs[0]?.error)).toMatch(/could not be checked.*database unavailable/)
		expect(String(rows.docs[0]?.error)).not.toMatch(/can no longer read/)
		await booted.payload.delete({ collection: 'webhook-subscriptions', id, overrideAccess: true })
	})

	/** A deleted document cannot be re-read, so a delete asks about the collection instead. */
	it('does not deliver a queued delete once the owner can no longer read the collection', async () => {
		const id = await subscribe('qd', memberA, ['posts.deleted'])
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'going', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })
		const collection = booted.payload.collections.posts
		if (!collection) {
			throw new Error('the posts collection is not registered')
		}
		const configured = collection.config.access.read
		collection.config.access.read = ({ req }) => (req.user as Who)?.role === 'admin'
		try {
			await booted.payload.jobs.run({ overrideAccess: true })
		} finally {
			collection.config.access.read = configured
		}
		expect(hits).toHaveLength(0)
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			where: { subscriptionId: { equals: id } },
			overrideAccess: true,
		})
		expect(rows.docs).toHaveLength(1)
		expect(rows.docs[0]?.status).toBe('dead')
		expect(String(rows.docs[0]?.error)).toMatch(/can no longer read this document/)
		await booted.payload.delete({ collection: 'webhook-subscriptions', id, overrideAccess: true })
	})
})
