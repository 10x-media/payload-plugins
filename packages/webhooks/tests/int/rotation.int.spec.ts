import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECRET_MASK } from '../../src/constants'
import { webhooks } from '../../src/index'
import { isEncryptedSecret } from '../../src/secrets/crypto'
import { generateSecret, secretKey } from '../../src/secrets/format'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

/** Every signature carried by a captured delivery, in header order. */
const signatures = (hit: Hit): string[] =>
	String(hit.headers['webhook-signature'] ?? '')
		.split(' ')
		.filter(Boolean)
		.map((part) => part.split(',')[1] ?? '')

/** The signature a receiver holding `secret` would compute for this delivery. */
const expected = (hit: Hit, secret: string): string =>
	createHmac('sha256', secretKey(secret))
		.update(`${hit.headers['webhook-id']}.${hit.headers['webhook-timestamp']}.${hit.body}`)
		.digest('base64')

describe('signing secret rotation', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: Hit[] = []

	const req = () => ({ context: {}, payload: booted.payload }) as unknown as PayloadRequest

	const rotate = (args: { id: string; secret?: string; graceSeconds: number; now?: number }) =>
		rotateSubscriptionSecret({
			payload: booted.payload,
			req: req(),
			subscriptionsSlug: 'webhook-subscriptions',
			...args,
		})

	const createSubscription = async (name: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})

	const triggerDelivery = async (): Promise<Hit> => {
		hits = []
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'rotate' },
			overrideAccess: true,
		})
		const hit = hits[0]
		if (!hit) {
			throw new Error('no delivery captured')
		}
		return hit
	}

	const rawRow = async (name: string): Promise<Record<string, unknown>> => {
		const { connection } = booted.payload.db as unknown as {
			connection: {
				collection: (collection: string) => {
					findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>
				}
			}
		}
		const doc = await connection.collection('webhook-subscriptions').findOne({ name })
		if (!doc) {
			throw new Error(`no raw row named ${name}`)
		}
		return doc
	}

	const removeAllSubscriptions = () =>
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
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	it('issues a new secret and keeps the old one signing during the grace period', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('grace')
		const original = String(created.secret)

		const result = await rotate({ id: String(created.id), graceSeconds: 3600 })
		expect(result.secret).not.toBe(original)
		expect(result.previousSecretExpiresAt).not.toBeNull()

		const hit = await triggerDelivery()
		expect(signatures(hit)).toEqual([expected(hit, result.secret), expected(hit, original)])
	})

	it('accepts a customer-supplied rotation secret', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('supplied')
		const original = String(created.secret)
		const chosen = generateSecret()

		const result = await rotate({ id: String(created.id), secret: chosen, graceSeconds: 3600 })
		expect(result.secret).toBe(chosen)

		const hit = await triggerDelivery()
		expect(signatures(hit)).toEqual([expected(hit, chosen), expected(hit, original)])
	})

	it('rejects a malformed rotation secret and leaves the subscription untouched', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('bad')
		const before = await rawRow('bad')

		await expect(
			rotate({ id: String(created.id), secret: 'not base64!', graceSeconds: 3600 })
		).rejects.toThrow(/invalid signing secret/)

		expect((await rawRow('bad')).secret).toBe(before.secret)
	})

	it('stops signing with the old secret once the grace period lapses', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('lapsed')
		const original = String(created.secret)

		// Rotate into the past so the window is already closed, no waiting required.
		const result = await rotate({
			id: String(created.id),
			graceSeconds: 60,
			now: Date.now() - 120_000,
		})

		const hit = await triggerDelivery()
		expect(signatures(hit)).toEqual([expected(hit, result.secret)])
		expect(signatures(hit)).not.toContain(expected(hit, original))
	})

	it('retires the old secret immediately when the grace period is zero', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('immediate')
		const original = String(created.secret)

		const result = await rotate({ id: String(created.id), graceSeconds: 0 })
		expect(result.previousSecretExpiresAt).toBeNull()

		const hit = await triggerDelivery()
		expect(signatures(hit)).toEqual([expected(hit, result.secret)])
		expect(signatures(hit)).not.toContain(expected(hit, original))
	})

	it('stores both secrets encrypted and keeps reads masked', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('stored')
		const original = String(created.secret)

		const result = await rotate({ id: String(created.id), graceSeconds: 3600 })

		const raw = await rawRow('stored')
		expect(isEncryptedSecret(raw.secret)).toBe(true)
		expect(isEncryptedSecret(raw.previousSecret)).toBe(true)
		expect(JSON.stringify(raw)).not.toContain(result.secret.slice('whsec_'.length))
		expect(JSON.stringify(raw)).not.toContain(original.slice('whsec_'.length))

		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBe(SECRET_MASK)
		expect(reread.previousSecret).toBe(SECRET_MASK)
	})

	it('survives a fresh Payload initialization mid-grace', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('restart')
		const original = String(created.secret)
		const result = await rotate({ id: String(created.id), graceSeconds: 3600 })

		const restarted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
			attachTo: booted,
		})
		try {
			hits = []
			await restarted.payload.create({
				collection: 'posts',
				data: { title: 'after restart' },
				overrideAccess: true,
			})
			const hit = hits[0]
			if (!hit) {
				throw new Error('no delivery captured after restart')
			}
			expect(signatures(hit)).toEqual([expected(hit, result.secret), expected(hit, original)])
		} finally {
			await restarted.stop()
		}
	})

	it('rotates again without stacking more than two signatures', async () => {
		await removeAllSubscriptions()
		const created = await createSubscription('twice')
		const first = await rotate({ id: String(created.id), graceSeconds: 3600 })
		const second = await rotate({ id: String(created.id), graceSeconds: 3600 })

		const hit = await triggerDelivery()
		expect(signatures(hit)).toEqual([expected(hit, second.secret), expected(hit, first.secret)])
	})
})
