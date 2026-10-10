import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { GENERATED_SECRET_KEY } from '../../src/constants'
import { pruneDeliveries, webhooks } from '../../src/index'
import { resolveSubscriptionById } from '../../src/plugin/resolveSubscriptions'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'
import { LOCAL_SINK } from './localSink'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

describeForDb('webhooks outbound cross-db', {}, (db) => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits = 0
	let authorization: string | undefined

	beforeAll(async () => {
		sink = createServer((request, res) => {
			hits += 1
			authorization = request.headers.authorization
			res.writeHead(200)
			res.end('ok')
		})
		await new Promise<void>((r) => sink.listen(0, r))
		const addr = sink.address()
		if (addr === null || typeof addr === 'string') {
			throw new Error('no port')
		}
		sinkUrl = `http://127.0.0.1:${addr.port}`
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', ...LOCAL_SINK },
			}),
			db,
			collections: [posts],
		})
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 's',
				url: sinkUrl,
				enabled: true,
				events: ['posts.created'],
				// Sealed at rest and decrypted for the send. Header rows are a subdocument array on Mongo
				// and a joined table on Postgres, and the resolver matches them by row id across two reads.
				headers: [{ key: 'Authorization', value: 'Bearer matrix-t0ken' }],
			},
			overrideAccess: true,
		})
		// Listens for a different event. The dispatcher narrows on the event in the `where` clause,
		// and that clause has to translate identically on both adapters: a hasMany select is a
		// column on Mongo and a join table on Postgres, so a narrowing that is right on one and
		// wrong on the other silently drops every delivery for this subscription.
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'other', url: sinkUrl, enabled: true, events: ['posts.deleted'] },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	it(`delivers to the subscription listening for the event, and only that one, on ${db}`, async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		expect(hits).toBe(1)
		const deliveries = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(deliveries.totalDocs).toBe(1)
		expect(deliveries.docs[0]?.status).toBe('success')
		expect(deliveries.docs[0]?.event).toBe('posts.created')
		expect(deliveries.docs[0]?.subscriptionSource).toBe('collection')
		expect(authorization).toBe('Bearer matrix-t0ken')
	})

	// The prune deletes through the adapter rather than the Local API, so its `where` has to
	// translate on both. Run from a point in the future instead of backdating the row.
	it(`prunes finished deliveries past the retention window on ${db}`, async () => {
		const total = async () =>
			(await booted.payload.count({ collection: 'webhook-deliveries', overrideAccess: true }))
				.totalDocs
		await pruneDeliveries(booted.payload, { olderThanDays: 30 })
		expect(await total()).toBe(1)
		await pruneDeliveries(booted.payload, { olderThanDays: 30, now: Date.now() + 31 * 86_400_000 })
		expect(await total()).toBe(0)
	})
})

/**
 * The rotation lifecycle across both databases, because two of its steps are adapter-shaped.
 *
 * `previousSecretExpiresAt` comes back as an ISO string from Mongo and as a `Date` from the SQL
 * adapters, and both the grace check and the lapsed-rotation cleanup branch on it. The
 * compare-and-swap then requires a long sealed string to compare equal, which is a column
 * comparison on one adapter and a document match on the other.
 */
describeForDb('webhooks rotation lifecycle', {}, (db) => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: { headers: IncomingHttpHeaders; body: string }[] = []

	const req = () => ({ context: {}, payload: booted.payload }) as unknown as PayloadRequest

	/** Every signature carried by the last captured delivery, in header order. */
	const deliver = async (title: string): Promise<string[]> => {
		hits = []
		await booted.payload.create({ collection: 'posts', data: { title }, overrideAccess: true })
		const hit = hits[0]
		if (!hit) {
			throw new Error('no delivery captured')
		}
		return String(hit.headers['webhook-signature'] ?? '')
			.split(' ')
			.filter(Boolean)
	}

	const subscribe = async (name: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})

	const rotate = (args: { id: string; graceSeconds: number; now?: number }) =>
		rotateSubscriptionSecret({
			payload: booted.payload,
			req: req(),
			subscriptionsSlug: 'webhook-subscriptions',
			...args,
		})

	const clear = () =>
		booted.payload.delete({ collection: 'webhook-subscriptions', where: {}, overrideAccess: true })

	beforeAll(async () => {
		sink = createServer((request, res) => {
			let body = ''
			request.on('data', (c) => {
				body += c
			})
			request.on('end', () => {
				hits.push({ headers: request.headers, body })
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
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', retries: 0, ...LOCAL_SINK },
			}),
			db,
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	it(`signs with both secrets inside the grace window on ${db}`, async () => {
		await clear()
		const created = await subscribe('grace-open')
		expect(await deliver('before')).toHaveLength(1)

		await rotate({ id: String(created.id), graceSeconds: 3600 })
		expect(await deliver('during')).toHaveLength(2)
	})

	it(`stops signing with the retired secret once the window closes on ${db}`, async () => {
		await clear()
		const created = await subscribe('grace-closed')
		// Dated into the past, so the stored expiry is already lapsed by the time it is read back.
		await rotate({ id: String(created.id), graceSeconds: 60, now: Date.now() - 120_000 })
		expect(await deliver('after')).toHaveLength(1)
	})

	it(`retires the old secret immediately with a zero grace on ${db}`, async () => {
		await clear()
		const created = await subscribe('no-grace')
		await rotate({ id: String(created.id), graceSeconds: 0 })
		expect(await deliver('none')).toHaveLength(1)
	})

	it(`clears a lapsed rotation on the next write on ${db}`, async () => {
		await clear()
		const created = await subscribe('lapsed')
		await rotate({ id: String(created.id), graceSeconds: 60, now: Date.now() - 120_000 })
		const rotated = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(rotated.previousSecret_set).toBe(true)

		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: { name: 'lapsed renamed' },
			overrideAccess: true,
		})
		const cleaned = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(cleaned.previousSecret_set).toBe(false)
		expect(cleaned.previousSecretExpiresAt).toBeNull()
	})

	it(`rotates twice without stacking more than two signatures on ${db}`, async () => {
		await clear()
		const created = await subscribe('twice')
		await rotate({ id: String(created.id), graceSeconds: 3600 })
		await rotate({ id: String(created.id), graceSeconds: 3600 })
		expect(await deliver('twice')).toHaveLength(2)
	})
})

/**
 * Rotation is a read-modify-write, and the databases disagree about what protects it. Mongo aborts
 * one side of a contended transaction; Postgres' default READ COMMITTED happily lets the second
 * write land on top of the first. Only the conditional write covers both.
 *
 * The invariant is stated without reference to who won, because completion order is not
 * observable: `Promise.allSettled` reports results in input order, not commit order. What a lost
 * update looks like is that both rotations retired the *pre-rotation* secret, because the second
 * one never saw the first. So the tell is the original still sitting in the grace window after two
 * rotations succeeded, and that holds whichever of them committed last.
 */
describeForDb('webhooks rotation concurrency', {}, (db) => {
	let booted: BootedPayload

	const req = () => ({ context: {}, payload: booted.payload }) as unknown as PayloadRequest

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', ...LOCAL_SINK },
			}),
			db,
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`never loses a rotation to a concurrent one on ${db}`, async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: `race-${db}`, url: 'https://example.test', enabled: true, events: [] },
			overrideAccess: true,
		})
		const id = String(created.id)
		const original = String(created[GENERATED_SECRET_KEY])

		// Recorded as each rotation resolves, so this is completion order. `Promise.allSettled`
		// reports in input order, which says nothing about which rotation committed last, and the
		// one that committed last is the one whose secret is now active.
		const completed: string[] = []
		const rotate = () =>
			rotateSubscriptionSecret({
				payload: booted.payload,
				req: req(),
				subscriptionsSlug: 'webhook-subscriptions',
				id,
				graceSeconds: 3600,
			}).then((result) => {
				completed.push(result.secret)
				return result
			})

		const settled = await Promise.allSettled([rotate(), rotate()])
		expect(completed.length).toBeGreaterThan(0)

		const resolved = await resolveSubscriptionById({
			id,
			codeSubscriptions: [],
			subscriptionsSlug: 'webhook-subscriptions',
			payload: booted.payload,
			req: req(),
		})
		expect(resolved?.secretUnusable).toBe(false)

		// The last rotation to finish holds the active secret.
		expect(resolved?.secrets[0]).toBe(completed[completed.length - 1])

		if (completed.length === 2) {
			// Both committed, so the second read the first's secret and retired that. The original
			// still sitting in the window is what a lost update looks like: it would mean the second
			// rotation never saw the first, and overwrote it while telling its caller otherwise.
			expect(resolved?.secrets).not.toContain(original)
			expect(new Set(resolved?.secrets)).toEqual(new Set(completed))
		} else {
			// One was refused, so the winner is active and the untouched original is its overlap.
			expect(resolved?.secrets).toEqual([completed[0], original])
		}

		// A refusal has to be the conflict, not some unrelated failure dressed up as one.
		for (const r of settled) {
			if (r.status === 'rejected') {
				expect(String(r.reason?.message ?? r.reason)).toMatch(
					/modified during rotation|conflict|serialize/i
				)
			}
		}
	})
})

/**
 * The owner read happens inside the write's own transaction, through a request the plugin builds
 * itself. Whether that request sees the uncommitted row is adapter behaviour, a session on Mongo
 * and a connection on Postgres, so it is proven on both.
 */
describeForDb('webhooks owner access cross-db', {}, (db) => {
	let booted: BootedPayload
	let sink: Server
	let paths: string[] = []

	const tenantUsers: CollectionConfig = {
		slug: 'users',
		auth: true,
		access: { read: () => true },
		fields: [{ name: 'tenant', type: 'text' }],
	}
	const tenantPosts: CollectionConfig = {
		slug: 'posts',
		access: {
			read: ({ req }) =>
				req.user ? { tenant: { equals: (req.user as { tenant?: string }).tenant } } : false,
		},
		fields: [
			{ name: 'title', type: 'text' },
			{ name: 'tenant', type: 'text' },
		],
	}
	const allow = () => true

	beforeAll(async () => {
		sink = createServer((request, res) => {
			paths.push(request.url ?? '')
			res.writeHead(200)
			res.end('ok')
		})
		await new Promise<void>((r) => sink.listen(0, r))
		const addr = sink.address()
		if (addr === null || typeof addr === 'string') {
			throw new Error('no port')
		}
		const sinkUrl = `http://127.0.0.1:${addr.port}`
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', ...LOCAL_SINK },
				enforceOwnerAccess: true,
				owner: {
					resolve: async ({ subscription, req }) => ({
						user: {
							...(await req.payload.findByID({
								collection: 'users',
								id: subscription.record.owner as number | string,
								depth: 0,
								overrideAccess: true,
								req,
							})),
							collection: 'users',
						},
					}),
				},
				subscriptionsCollection: {
					overrides: {
						access: { read: allow, create: allow, update: allow, delete: allow },
						fields: ({ defaultFields }) => [
							...defaultFields,
							{ name: 'owner', type: 'relationship', relationTo: 'users' },
						],
					},
				},
				deliveriesLog: { overrides: { access: { read: allow, delete: allow } } },
			}),
			db,
			collections: [tenantUsers, tenantPosts],
		})
		for (const tenant of ['a', 'b']) {
			const user = await booted.payload.create({
				collection: 'users',
				data: { email: `${tenant}@test.dev`, password: 'test1234', tenant },
				overrideAccess: true,
			})
			await booted.payload.create({
				collection: 'webhook-subscriptions',
				data: {
					name: tenant,
					url: `${sinkUrl}/${tenant}`,
					enabled: true,
					events: ['posts.created', 'posts.deleted'],
					owner: user.id,
				},
				overrideAccess: true,
			})
		}
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	it(`sees the uncommitted document as its owner, and only as its owner, on ${db}`, async () => {
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		expect(paths).toEqual(['/a'])
		// The owner read ran on the write's own transaction, and left it standing.
		const kept = await booted.payload.count({
			collection: 'posts',
			where: { id: { equals: post.id } },
			overrideAccess: true,
		})
		expect(kept.totalDocs).toBe(1)
		paths = []
		await booted.payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })
		expect(paths).toEqual(['/a'])
	})
})
