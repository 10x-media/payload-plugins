import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import { resolveSubscriptionById } from '../../src/plugin/resolveSubscriptions'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

describeForDb('webhooks outbound cross-db', {}, (db) => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits = 0

	beforeAll(async () => {
		sink = createServer((_req, res) => {
			hits += 1
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
			plugin: webhooks({ collections: { posts: true }, delivery: 'inline' }),
			db,
			collections: [posts],
		})
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 's', url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	it(`delivers on ${db}`, async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		expect(hits).toBe(1)
		const deliveries = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(deliveries.docs[0]?.status).toBe('success')
	})
})

/**
 * Rotation is a read-modify-write, and the databases disagree about what protects it. Mongo
 * aborts one side of a contended transaction; Postgres' default READ COMMITTED happily lets the
 * second write land on top of the first. Only the conditional write covers both, so the invariant
 * is asserted against each: a caller handed a new secret must never find it was discarded.
 */
describeForDb('webhooks rotation concurrency', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: 'inline' }),
			db,
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`never hands out a secret that stopped signing on ${db}`, async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: `race-${db}`, url: 'https://example.test', enabled: true, events: [] },
			overrideAccess: true,
		})
		const id = String(created.id)

		const settled = await Promise.allSettled(
			Array.from({ length: 4 }, () =>
				rotateSubscriptionSecret({
					payload: booted.payload,
					req: { context: {}, payload: booted.payload } as unknown as PayloadRequest,
					subscriptionsSlug: 'webhook-subscriptions',
					id,
					graceSeconds: 3600,
				})
			)
		)

		const issued = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value.secret] : []))
		expect(issued.length).toBeGreaterThan(0)

		const resolved = await resolveSubscriptionById({
			id,
			codeSubscriptions: [],
			subscriptionsSlug: 'webhook-subscriptions',
			payload: booted.payload,
			req: { context: {}, payload: booted.payload } as unknown as PayloadRequest,
		})

		// The last caller to be told "this is your new secret" must hold the active one, and no
		// rotation may have been overwritten without its caller learning through a rejection.
		expect(resolved?.secrets[0]).toBe(issued[issued.length - 1])
		expect(resolved?.secretUnusable).toBe(false)
	})
})
