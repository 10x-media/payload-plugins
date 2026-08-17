import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { Webhook } from 'standardwebhooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import { generateSecret } from '../../src/secrets/format'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

/** The three headers the Standard Webhooks verifier requires, as the sink received them. */
const standardHeaders = (hit: Hit): Record<string, string> => ({
	'webhook-id': String(hit.headers['webhook-id']),
	'webhook-timestamp': String(hit.headers['webhook-timestamp']),
	'webhook-signature': String(hit.headers['webhook-signature']),
})

/**
 * The receiver example the docs publish, kept here verbatim in behaviour so a change to the
 * documented snippet that breaks verification fails the suite. Deliberately hand-rolled: it is
 * what a reader copies when they do not reach for a library.
 */
const documentedReceiver = (args: {
	secret: string
	id: string
	timestamp: string
	rawBody: string
	signatureHeader: string
	toleranceSeconds?: number
	now?: number
}): boolean => {
	const { secret, id, timestamp, rawBody, signatureHeader } = args
	const tolerance = args.toleranceSeconds ?? 300
	const now = (args.now ?? Date.now()) / 1000

	const age = Math.abs(now - Number(timestamp))
	if (!Number.isFinite(age) || age > tolerance) {
		return false
	}

	const expected = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
		.update(`${id}.${timestamp}.${rawBody}`)
		.digest('base64')

	return signatureHeader.split(' ').some((part) => {
		const [version, signature] = part.split(',')
		if (version !== 'v1' || !signature) {
			return false
		}
		const a = Buffer.from(signature)
		const b = Buffer.from(expected)
		return a.length === b.length && timingSafeEqual(a, b)
	})
}

describe('interoperability with the standardwebhooks verifier', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: Hit[] = []

	const captureDelivery = async (title: string): Promise<Hit> => {
		hits = []
		await booted.payload.create({ collection: 'posts', data: { title }, overrideAccess: true })
		const hit = hits[0]
		if (!hit) {
			throw new Error('no delivery captured')
		}
		return hit
	}

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

	const subscribe = async (name: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})

	const clear = () =>
		booted.payload.delete({ collection: 'webhook-subscriptions', where: {}, overrideAccess: true })

	it('produces a delivery the off-the-shelf verifier accepts', async () => {
		await clear()
		const created = await subscribe('interop')
		const secret = String(created.secret)

		const hit = await captureDelivery('verified by the reference library')

		const verifier = new Webhook(secret)
		const payload = verifier.verify(hit.body, standardHeaders(hit))
		expect(payload).toMatchObject({ event: 'posts.created' })
	})

	it('is rejected by the verifier when the body is altered in transit', async () => {
		await clear()
		const created = await subscribe('tampered')
		const hit = await captureDelivery('tamper')

		const verifier = new Webhook(String(created.secret))
		const tampered = `${hit.body.slice(0, -1)} `
		expect(() => verifier.verify(tampered, standardHeaders(hit))).toThrow()
	})

	it('is rejected by the verifier holding an unrelated secret', async () => {
		await clear()
		await subscribe('wrong-secret')
		const hit = await captureDelivery('wrong secret')

		const verifier = new Webhook(generateSecret())
		expect(() => verifier.verify(hit.body, standardHeaders(hit))).toThrow()
	})

	it('is rejected by the verifier when the delivery id is swapped', async () => {
		await clear()
		const created = await subscribe('swapped-id')
		const hit = await captureDelivery('swapped id')

		const verifier = new Webhook(String(created.secret))
		expect(() =>
			verifier.verify(hit.body, { ...standardHeaders(hit), 'webhook-id': 'msg_other' })
		).toThrow()
	})

	it('lets verifiers on either secret accept during a rotation grace period', async () => {
		await clear()
		const created = await subscribe('rotating')
		const original = String(created.secret)

		const rotated = await rotateSubscriptionSecret({
			payload: booted.payload,
			req: { context: {}, payload: booted.payload } as unknown as PayloadRequest,
			subscriptionsSlug: 'webhook-subscriptions',
			id: String(created.id),
			graceSeconds: 3600,
		})

		const hit = await captureDelivery('mid rotation')

		expect(new Webhook(rotated.secret).verify(hit.body, standardHeaders(hit))).toMatchObject({
			event: 'posts.created',
		})
		expect(new Webhook(original).verify(hit.body, standardHeaders(hit))).toMatchObject({
			event: 'posts.created',
		})
	})

	it('stops the retired secret verifying once the grace period has lapsed', async () => {
		await clear()
		const created = await subscribe('lapsed')
		const original = String(created.secret)

		const rotated = await rotateSubscriptionSecret({
			payload: booted.payload,
			req: { context: {}, payload: booted.payload } as unknown as PayloadRequest,
			subscriptionsSlug: 'webhook-subscriptions',
			id: String(created.id),
			graceSeconds: 60,
			now: Date.now() - 120_000,
		})

		const hit = await captureDelivery('after grace')

		expect(new Webhook(rotated.secret).verify(hit.body, standardHeaders(hit))).toMatchObject({
			event: 'posts.created',
		})
		expect(() => new Webhook(original).verify(hit.body, standardHeaders(hit))).toThrow()
	})

	describe('the documented receiver example', () => {
		it('accepts a real delivery', async () => {
			await clear()
			const created = await subscribe('documented')
			const hit = await captureDelivery('documented receiver')

			expect(
				documentedReceiver({
					secret: String(created.secret),
					id: String(hit.headers['webhook-id']),
					timestamp: String(hit.headers['webhook-timestamp']),
					rawBody: hit.body,
					signatureHeader: String(hit.headers['webhook-signature']),
				})
			).toBe(true)
		})

		it('agrees with the reference library on the same delivery', async () => {
			await clear()
			const created = await subscribe('agreement')
			const hit = await captureDelivery('agreement')
			const secret = String(created.secret)

			const byLibrary = (() => {
				try {
					new Webhook(secret).verify(hit.body, standardHeaders(hit))
					return true
				} catch {
					return false
				}
			})()

			expect(
				documentedReceiver({
					secret,
					id: String(hit.headers['webhook-id']),
					timestamp: String(hit.headers['webhook-timestamp']),
					rawBody: hit.body,
					signatureHeader: String(hit.headers['webhook-signature']),
				})
			).toBe(byLibrary)
			expect(byLibrary).toBe(true)
		})

		/**
		 * Offsets are measured from the delivery's own timestamp rather than wall clock, so the
		 * margin under test is exact and does not shrink when a loaded run puts seconds between
		 * capturing the delivery and asserting on it.
		 */
		const atOffset = async (name: string, offsetSeconds: number) => {
			await clear()
			const created = await subscribe(name)
			const hit = await captureDelivery(name)
			const timestamp = String(hit.headers['webhook-timestamp'])
			return documentedReceiver({
				secret: String(created.secret),
				id: String(hit.headers['webhook-id']),
				timestamp,
				rawBody: hit.body,
				signatureHeader: String(hit.headers['webhook-signature']),
				now: (Number(timestamp) + offsetSeconds) * 1000,
			})
		}

		it('rejects a timestamp older than the tolerance', async () => {
			expect(await atOffset('stale', 301)).toBe(false)
		})

		it('rejects a timestamp too far in the future', async () => {
			expect(await atOffset('future', -301)).toBe(false)
		})

		it('accepts a timestamp just inside the tolerance', async () => {
			expect(await atOffset('inside', 299)).toBe(true)
			expect(await atOffset('inside-past', -299)).toBe(true)
		})

		it('ignores a signature carrying an unknown version tag', async () => {
			await clear()
			const created = await subscribe('tagged')
			const hit = await captureDelivery('tagged')
			const real = String(hit.headers['webhook-signature'])

			const verify = (signatureHeader: string) =>
				documentedReceiver({
					secret: String(created.secret),
					id: String(hit.headers['webhook-id']),
					timestamp: String(hit.headers['webhook-timestamp']),
					rawBody: hit.body,
					signatureHeader,
				})

			// The same bytes under a different scheme tag must not be accepted as v1.
			expect(verify(real.replace('v1,', 'v2,'))).toBe(false)
			// A malformed entry alongside the real one must not stop the real one matching.
			expect(verify(`v2,${real.split(',')[1]} ${real}`)).toBe(true)
			expect(verify('v1, garbage')).toBe(false)
			expect(verify('')).toBe(false)
		})

		it('rejects a non-numeric timestamp', async () => {
			await clear()
			const created = await subscribe('nan')
			const hit = await captureDelivery('nan')

			expect(
				documentedReceiver({
					secret: String(created.secret),
					id: String(hit.headers['webhook-id']),
					timestamp: 'not-a-number',
					rawBody: hit.body,
					signatureHeader: String(hit.headers['webhook-signature']),
				})
			).toBe(false)
		})
	})
})
