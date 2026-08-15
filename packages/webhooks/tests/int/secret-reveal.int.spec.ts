import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_PREFIX } from '../../src/constants'
import { webhooks } from '../../src/index'
import { secretKey } from '../../src/secrets/format'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

const RAW_SECRET = /^whsec_[A-Za-z0-9+/]+={0,2}$/
const SIGNATURE = /^v1,([A-Za-z0-9+/]+={0,2})$/

describe('subscription secret reveal-once', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: Hit[] = []

	beforeAll(async () => {
		sink = createServer((req, res) => {
			let body = ''
			req.on('data', (c) => {
				body += c
			})
			req.on('end', () => {
				hits.push({ headers: req.headers, body })
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

	it('reveals the raw secret once on create, masks it on later reads, and signs with the raw value', async () => {
		hits = []
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'reveal', url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
		const rawSecret = String(created.secret)
		expect(rawSecret).toMatch(RAW_SECRET)

		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBe(SECRET_MASK)
		expect(reread.secret).not.toBe(rawSecret)

		const listed = await booted.payload.find({
			collection: 'webhook-subscriptions',
			overrideAccess: true,
		})
		expect(listed.docs.every((d) => d.secret === SECRET_MASK)).toBe(true)

		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Signed' },
			overrideAccess: true,
		})
		expect(hits).toHaveLength(1)
		const hit = hits[0]
		if (!hit) {
			throw new Error('no delivery captured')
		}

		const header = hit.headers['webhook-signature']
		const timestamp = hit.headers['webhook-timestamp']
		const deliveryId = hit.headers['webhook-id']
		expect(typeof header).toBe('string')
		expect(typeof timestamp).toBe('string')
		expect(typeof deliveryId).toBe('string')
		const match = SIGNATURE.exec(String(header))
		expect(match).not.toBeNull()
		const received = match?.[1] ?? ''

		const expectedRaw = createHmac('sha256', secretKey(rawSecret))
			.update(`${deliveryId}.${timestamp}.${hit.body}`)
			.digest('base64')
		expect(received).toBe(expectedRaw)

		const expectedAscii = createHmac('sha256', rawSecret.slice(SECRET_PREFIX.length))
			.update(`${deliveryId}.${timestamp}.${hit.body}`)
			.digest('base64')
		expect(received).not.toBe(expectedAscii)
	})
})
