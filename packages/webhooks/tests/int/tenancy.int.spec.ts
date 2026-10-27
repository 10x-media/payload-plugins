import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { Access, CollectionConfig, FieldAccess, TypedUser } from 'payload'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import { LOCAL_SINK } from './localSink'

type Who = { id?: number | string; role?: string; tenant?: string } | null | undefined
const isAdmin = (user: Who): boolean => user?.role === 'admin'
const adminField: FieldAccess = ({ req }) => isAdmin(req.user as Who)

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	access: { read: () => true },
	fields: [
		{ name: 'role', type: 'text' },
		{ name: 'tenant', type: 'text' },
	],
}

const tenantRead: Access = ({ req }) => {
	const user = req.user as Who
	if (!user) {
		return false
	}
	return isAdmin(user) ? true : { tenant: { equals: user.tenant } }
}

const posts: CollectionConfig = {
	slug: 'posts',
	access: { read: tenantRead },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text' },
		{ name: 'internalNote', type: 'text', access: { read: adminField } },
	],
}

/** Only operators read it, to prove an owner cannot subscribe past their own access. */
const vaults: CollectionConfig = {
	slug: 'vaults',
	access: { read: ({ req }) => isAdmin(req.user as Who) },
	fields: [{ name: 'title', type: 'text' }],
}

const ownScope: Access = ({ req }) => {
	const user = req.user as Who
	if (!user) {
		return false
	}
	return isAdmin(user) ? true : { owner: { equals: user.id } }
}

const ownDeliveries: Access = ({ req }) => {
	const user = req.user as Who
	if (!user) {
		return false
	}
	return isAdmin(user)
		? true
		: { ownerId: { equals: String(user.id) }, ownerCollection: { equals: 'users' } }
}

/** The configuration the multi-tenancy docs page shows. Keep the two in step. */
const tenancyPlugin = (sinkUrl: string) =>
	webhooks({
		collections: { posts: { includePreviousData: true }, vaults: true },
		subscriptions: [
			{
				id: 'ops',
				url: `${sinkUrl}/ops`,
				events: ['posts.created', 'posts.updated', 'posts.deleted'],
			},
		],
		delivery: { mode: 'inline', retries: 0, ...LOCAL_SINK },
		enforceOwnerAccess: true,
		owner: {
			resolve: async ({ subscription, req }) => {
				const ownerId = subscription.record.owner
				if (typeof ownerId !== 'string' && typeof ownerId !== 'number') {
					return null
				}
				try {
					const user = await req.payload.findByID({
						collection: 'users',
						id: ownerId,
						depth: 0,
						overrideAccess: true,
						req,
					})
					return { user: { ...user, collection: 'users' } }
				} catch {
					return null
				}
			},
			canActAs: ({ owner, req }) =>
				isAdmin(req.user as Who) ||
				(!owner.global && String(owner.user.id) === String(req.user?.id)),
		},
		subscriptionsCollection: {
			overrides: {
				access: {
					read: ownScope,
					create: ({ req }) => Boolean(req.user),
					update: ownScope,
					delete: ownScope,
				},
				fields: ({ defaultFields }) => [
					...defaultFields,
					{
						name: 'owner',
						type: 'relationship',
						relationTo: 'users',
						index: true,
						access: { create: adminField, update: adminField },
					},
				],
				hooks: {
					beforeValidate: [
						// Field access has already dropped an owner the caller may not set, so "absent"
						// covers both a tenant who sent none and one who tried to name somebody else.
						({ data, operation, req }) =>
							operation === 'create' && req.user && data && data.owner == null
								? { ...data, owner: req.user.id }
								: data,
					],
				},
			},
		},
		deliveriesLog: {
			overrides: { access: { read: ownDeliveries, delete: ({ req }) => isAdmin(req.user as Who) } },
		},
	})

let sink: Server
let sinkUrl: string
let hits: { path: string; body: Record<string, unknown> }[] = []
let booted: BootedPayload
let admin: TypedUser
let memberA: TypedUser
let memberB: TypedUser
let subA: string
let subB: string

const createUser = async (email: string, role: string, tenant?: string) =>
	({
		...(await booted.payload.create({
			collection: 'users',
			data: { email, password: 'test1234', role, tenant },
			overrideAccess: true,
		})),
		collection: 'users',
	}) as unknown as TypedUser

const subscribeAs = async (user: TypedUser, path: string, events: string[]) =>
	String(
		(
			await booted.payload.create({
				collection: 'webhook-subscriptions',
				data: { name: path, url: `${sinkUrl}/${path}`, enabled: true, events },
				user,
				overrideAccess: false,
			})
		).id
	)

const pathsHit = () => hits.map((h) => h.path).sort()
const bodyAt = (path: string) => hits.find((h) => h.path === path)?.body
const deliveriesFor = async (subscriptionId: string) =>
	(
		await booted.payload.find({
			collection: 'webhook-deliveries',
			where: { subscriptionId: { equals: subscriptionId } },
			overrideAccess: true,
			sort: '-createdAt',
		})
	).docs

/** Whether a document is really in the database, read outside any request. */
const stored = async (collection: 'posts' | 'vaults', id: number | string): Promise<boolean> =>
	(
		await booted.payload.count({
			collection,
			where: { id: { equals: id } },
			overrideAccess: true,
		})
	).totalDocs === 1

const ALL = ['posts.created', 'posts.updated', 'posts.deleted']

beforeAll(async () => {
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
	booted = await bootPayload({
		db: 'mongo',
		collections: [users, posts, vaults],
		plugin: tenancyPlugin(sinkUrl),
	})
	admin = await createUser('admin@test.dev', 'admin')
	memberA = await createUser('a@test.dev', 'member', 'a')
	memberB = await createUser('b@test.dev', 'member', 'b')
	subA = await subscribeAs(memberA, 'a', ALL)
	subB = await subscribeAs(memberB, 'b', ALL)
})

afterAll(async () => {
	await booted.stop()
	await new Promise<void>((r) => sink.close(() => r()))
})

beforeEach(() => {
	hits = []
})

describe('dispatch under enforceOwnerAccess', () => {
	it('delivers a tenant document to that tenant and to the code subscription, and to nobody else', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'for a', tenant: 'a' },
			user: admin,
			overrideAccess: false,
		})
		expect(pathsHit()).toEqual(['/a', '/ops'])
		expect((await deliveriesFor(subB)).filter((d) => d.event === 'posts.created')).toHaveLength(0)
	})

	/** Review Focus 2: the writer reads more than the owner does. */
	it('sends the owner their own view of the document, not the view of the writer', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'noted', tenant: 'a', internalNote: 'admins only' },
			user: admin,
			overrideAccess: false,
		})
		const toOwner = bodyAt('/a')?.data as Record<string, unknown>
		const toOps = bodyAt('/ops')?.data as Record<string, unknown>
		expect(toOwner.title).toBe('noted')
		expect(toOwner).not.toHaveProperty('internalNote')
		expect(toOps.internalNote).toBe('admins only')
	})

	it('stamps the delivery row with its owner, and leaves the code subscription row unstamped', async () => {
		const row = (await deliveriesFor(subA))[0]
		expect(row?.ownerId).toBe(String(memberA.id))
		expect(row?.ownerCollection).toBe('users')
		expect((await deliveriesFor('ops'))[0]?.ownerId ?? null).toBe(null)
	})

	/** Review Focus 1: a document that changes tenant. */
	it('re-evaluates access per write: a document that moves tenant leaves the old one behind', async () => {
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'moving', tenant: 'a' },
			overrideAccess: true,
		})
		hits = []
		await booted.payload.update({
			collection: 'posts',
			id: post.id,
			data: { tenant: 'b' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/b', '/ops'])
		expect(bodyAt('/b')).not.toHaveProperty('previousData')
		expect(bodyAt('/ops')).toHaveProperty('previousData')
	})

	it('delivers a delete to the tenant that could read the document, with their view of it', async () => {
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'doomed', tenant: 'a', internalNote: 'admins only' },
			overrideAccess: true,
		})
		hits = []
		await booted.payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })
		expect(pathsHit()).toEqual(['/a', '/ops'])
		const data = bodyAt('/a')?.data as Record<string, unknown>
		expect(data.title).toBe('doomed')
		expect(data).not.toHaveProperty('internalNote')
	})

	/** Review Focus 3. */
	it('skips a subscription whose owner was deleted, without failing the write or leaving a row', async () => {
		const gone = await createUser('c@test.dev', 'member', 'c')
		const subC = await subscribeAs(gone, 'c', ALL)
		await booted.payload.delete({ collection: 'users', id: gone.id, overrideAccess: true })
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'c' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/ops'])
		expect(await deliveriesFor(subC)).toHaveLength(0)
		// The resolver's own lookup threw. That must stay its problem: the write is still there, and
		// so is the delivery made before the resolver was asked.
		await expect(stored('posts', post.id)).resolves.toBe(true)
		expect((await deliveriesFor('ops'))[0]?.status).toBe('success')
	})

	it('skips a row that has no owner at all', async () => {
		const orphan = await booted.payload.db.create({
			collection: 'webhook-subscriptions',
			data: { name: 'orphan', url: `${sinkUrl}/orphan`, enabled: true, events: ALL },
		})
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual(['/a', '/ops'])
		expect(await deliveriesFor(String(orphan.id))).toHaveLength(0)
		await expect(stored('posts', post.id)).resolves.toBe(true)
		await booted.payload.db.deleteOne({
			collection: 'webhook-subscriptions',
			where: { id: { equals: orphan.id } },
		})
	})

	/**
	 * A stored row can outlive its owner's access: the guard only runs on save. Payload answers a
	 * flat `false` from read access by throwing, and an operation that throws on the write's own
	 * transaction rolls that transaction back, so the denial must not reach it as a throw.
	 */
	it('leaves the write alone when the owner is flatly denied the collection', async () => {
		const stale = await booted.payload.db.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'stale',
				url: `${sinkUrl}/stale`,
				enabled: true,
				events: ['vaults.created'],
				owner: memberA.id,
			},
		})
		const vault = await booted.payload.create({
			collection: 'vaults',
			data: { title: 'sealed' },
			overrideAccess: true,
		})
		expect(pathsHit()).toEqual([])
		expect(await deliveriesFor(String(stale.id))).toHaveLength(0)
		await expect(stored('vaults', vault.id)).resolves.toBe(true)
		await booted.payload.db.deleteOne({
			collection: 'webhook-subscriptions',
			where: { id: { equals: stale.id } },
		})
	})
})

describe('saving a subscription under enforceOwnerAccess', () => {
	it('refuses events from a collection the owner cannot read, and allows an operator', async () => {
		await expect(subscribeAs(memberA, 'vault-a', ['vaults.created'])).rejects.toMatchObject({
			status: 403,
		})
		const ok = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'v',
				url: `${sinkUrl}/v`,
				enabled: true,
				events: ['vaults.created'],
				owner: admin.id,
			},
			user: admin,
			overrideAccess: false,
		})
		await booted.payload.delete({
			collection: 'webhook-subscriptions',
			id: ok.id,
			overrideAccess: true,
		})
	})

	it('refuses adding such an event on update as well', async () => {
		await expect(
			booted.payload.update({
				collection: 'webhook-subscriptions',
				id: subA,
				data: { events: [...ALL, 'vaults.created'] },
				user: memberA,
				overrideAccess: false,
			})
		).rejects.toMatchObject({ status: 403 })
	})

	/** Field access is one lock; the guard is the second, and holds when the first is bypassed. */
	it('refuses a member naming somebody else as owner even with field access bypassed', async () => {
		await expect(
			booted.payload.create({
				collection: 'webhook-subscriptions',
				data: { name: 'x', url: `${sinkUrl}/x`, enabled: true, events: ALL, owner: admin.id },
				user: memberA,
				overrideAccess: true,
			})
		).rejects.toMatchObject({ status: 403 })
		await expect(
			booted.payload.update({
				collection: 'webhook-subscriptions',
				id: subA,
				data: { owner: memberB.id },
				user: memberA,
				overrideAccess: true,
			})
		).rejects.toMatchObject({ status: 403 })
	})

	it('refuses a save that resolves to no owner', async () => {
		await expect(
			booted.payload.create({
				collection: 'webhook-subscriptions',
				data: { name: 'x', url: `${sinkUrl}/x`, enabled: true, events: ALL },
				overrideAccess: true,
			})
		).rejects.toMatchObject({ status: 403 })
	})

	it('lets an operator edit a tenant subscription without becoming its owner', async () => {
		const updated = await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: subA,
			data: { description: 'checked by ops' },
			user: admin,
			overrideAccess: false,
		})
		expect(String((updated.owner as { id?: unknown })?.id ?? updated.owner)).toBe(
			String(memberA.id)
		)
	})
})

describe('the REST surface, as another tenant', () => {
	const tokens = new Map<string, string>()
	const tokenFor = async (email: string) => {
		const cached = tokens.get(email)
		if (cached) {
			return cached
		}
		const { token } = await booted.payload.login({
			collection: 'users',
			data: { email, password: 'test1234' },
		})
		tokens.set(email, String(token))
		return String(token)
	}
	/** One REST call as a logged-in user, written the way it reads: `'PATCH /path'`. */
	const rest = async (email: string, call: string, body?: unknown) => {
		const [method, path] = call.split(' ')
		return handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, {
				method,
				headers: {
					Authorization: `JWT ${await tokenFor(email)}`,
					'Content-Type': 'application/json',
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		})
	}
	const denied = (status: number) => expect([403, 404]).toContain(status)

	let deliveryA: string
	let deliveryOps: string

	beforeAll(async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'rest', tenant: 'a' },
			overrideAccess: true,
		})
		deliveryA = String((await deliveriesFor(subA))[0]?.id)
		deliveryOps = String((await deliveriesFor('ops'))[0]?.id)
	})

	it('lists only the subscriptions the caller owns', async () => {
		const res = await rest('b@test.dev', 'GET /webhook-subscriptions?limit=100')
		const ids = ((await res.json()) as { docs: { id: unknown }[] }).docs.map((d) => String(d.id))
		expect(ids).toEqual([subB])
	})

	it('refuses reading, updating and deleting a subscription of another tenant by id', async () => {
		denied((await rest('b@test.dev', `GET /webhook-subscriptions/${subA}`)).status)
		denied(
			(await rest('b@test.dev', `PATCH /webhook-subscriptions/${subA}`, { enabled: false })).status
		)
		denied((await rest('b@test.dev', `DELETE /webhook-subscriptions/${subA}`)).status)
		const still = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: subA,
			overrideAccess: true,
		})
		expect(still.enabled).toBe(true)
	})

	it('never returns a secret on a read, and refuses rotating the secret of another tenant', async () => {
		const own = await rest('a@test.dev', `GET /webhook-subscriptions/${subA}`)
		const doc = (await own.json()) as Record<string, unknown>
		expect(doc.secret_set).toBe(true)
		expect(doc).not.toHaveProperty('secret')
		expect(doc).not.toHaveProperty('previousSecret')
		denied(
			(await rest('b@test.dev', `POST /webhook-subscriptions/${subA}/rotate-secret`, {})).status
		)
	})

	it('creates a subscription owned by the caller whatever owner the body names', async () => {
		const res = await rest('b@test.dev', 'POST /webhook-subscriptions', {
			name: 'sneaky',
			url: `${sinkUrl}/sneaky`,
			events: ALL,
			owner: admin.id,
		})
		expect(res.status).toBe(201)
		const { doc } = (await res.json()) as { doc: { id: string; owner: unknown } }
		expect(String((doc.owner as { id?: unknown })?.id ?? doc.owner)).toBe(String(memberB.id))
		await booted.payload.delete({
			collection: 'webhook-subscriptions',
			id: doc.id,
			overrideAccess: true,
		})
	})

	it('cannot move a subscription to another owner over REST', async () => {
		await rest('b@test.dev', `PATCH /webhook-subscriptions/${subB}`, { owner: admin.id })
		const row = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: subB,
			depth: 0,
			overrideAccess: true,
		})
		expect(String(row.owner)).toBe(String(memberB.id))
	})

	it('refuses subscribing to a collection the caller cannot read', async () => {
		const res = await rest('b@test.dev', 'POST /webhook-subscriptions', {
			name: 'vault',
			url: `${sinkUrl}/vault`,
			events: ['vaults.created'],
		})
		expect(res.status).toBe(403)
	})

	it('scopes the delivery log: no listing, reading or deleting rows of another tenant', async () => {
		const list = await rest('b@test.dev', 'GET /webhook-deliveries?limit=100')
		const rows = ((await list.json()) as { docs: { ownerId?: string }[] }).docs
		expect(rows.every((r) => r.ownerId === String(memberB.id))).toBe(true)
		denied((await rest('b@test.dev', `GET /webhook-deliveries/${deliveryA}`)).status)
		denied((await rest('b@test.dev', `DELETE /webhook-deliveries/${deliveryA}`)).status)
		denied((await rest('a@test.dev', `DELETE /webhook-deliveries/${deliveryA}`)).status)
	})

	it('refuses replaying a delivery of another tenant, or of the code subscription, by id', async () => {
		hits = []
		denied((await rest('b@test.dev', `POST /webhook-deliveries/${deliveryA}/redeliver`)).status)
		denied((await rest('a@test.dev', `POST /webhook-deliveries/${deliveryOps}/redeliver`)).status)
		expect(hits).toHaveLength(0)
	})

	it('lets the owner replay their own delivery, and keeps the replay theirs', async () => {
		hits = []
		const res = await rest('a@test.dev', `POST /webhook-deliveries/${deliveryA}/redeliver`)
		expect(res.status).toBe(202)
		const { id, status } = (await res.json()) as { id: string; status: string }
		expect(status).toBe('success')
		expect(pathsHit()).toEqual(['/a'])
		const replay = await booted.payload.findByID({
			collection: 'webhook-deliveries',
			id,
			overrideAccess: true,
		})
		expect(replay.ownerId).toBe(String(memberA.id))
	})

	/** The delivery is readable, the subscription behind it is not. */
	it('refuses a replay when the caller can read the delivery but not its subscription', async () => {
		const collection = booted.payload.collections['webhook-deliveries']
		if (!collection) {
			throw new Error('the deliveries collection is not registered')
		}
		const configured = collection.config.access.read
		collection.config.access.read = () => true
		try {
			hits = []
			expect(
				(await rest('b@test.dev', `POST /webhook-deliveries/${deliveryA}/redeliver`)).status
			).toBe(403)
			expect(hits).toHaveLength(0)
		} finally {
			collection.config.access.read = configured
		}
	})

	/** Review Focus 5. Runs last: it reassigns subA. */
	it('refuses replaying a delivery after its subscription changed owner', async () => {
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: subA,
			data: { owner: memberB.id, events: ALL },
			user: admin,
			overrideAccess: false,
		})
		hits = []
		const res = await rest('admin@test.dev', `POST /webhook-deliveries/${deliveryA}/redeliver`)
		expect(res.status).toBe(202)
		expect(((await res.json()) as { status: string }).status).toBe('dead')
		expect(hits).toHaveLength(0)
	})
})
