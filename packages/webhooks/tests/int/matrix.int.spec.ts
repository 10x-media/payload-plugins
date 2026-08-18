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
			plugin: webhooks({ collections: { posts: true }, delivery: 'inline' }),
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
		const original = String(created.secret)

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
