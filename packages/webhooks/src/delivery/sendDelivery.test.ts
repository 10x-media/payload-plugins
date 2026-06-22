import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromCodeSubscription } from '../plugin/resolveSubscriptions'
import { sendDelivery } from './sendDelivery'
import { signatureHeader, signPayload } from './sign'

let server: Server
let url: string
let received: { headers: IncomingHttpHeaders; body: string } | undefined

beforeAll(async () => {
	server = createServer((req, res) => {
		let body = ''
		req.on('data', (c) => {
			body += c
		})
		req.on('end', () => {
			received = { headers: req.headers, body }
			res.writeHead(200)
			res.end('ok')
		})
	})
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const addr = server.address()
	if (addr === null || typeof addr === 'string') {
		throw new Error('no port')
	}
	url = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('sendDelivery', () => {
	it('signs the body and sets identifying headers', async () => {
		const sub = fromCodeSubscription({
			id: 's',
			url,
			events: [],
			secret: 'k',
			headers: { 'X-Custom': 'c' },
		})
		const body = '{"id":"d1"}'
		const now = 1_700_000_000_000
		const r = await sendDelivery({
			subscription: sub,
			deliveryId: 'd1',
			event: 'posts.created',
			body,
			timeoutMs: 1000,
			now,
		})
		expect(r.ok).toBe(true)
		expect(received?.body).toBe(body)
		expect(received?.headers['x-webhook-id']).toBe('d1')
		expect(received?.headers['x-webhook-event']).toBe('posts.created')
		expect(received?.headers['x-webhook-timestamp']).toBe(String(Math.floor(now / 1000)))
		expect(received?.headers['x-custom']).toBe('c')
		expect(received?.headers['x-webhook-signature']).toBe(
			signatureHeader(signPayload({ secret: 'k', timestamp: Math.floor(now / 1000), body }))
		)
	})

	it('omits the signature when no secret', async () => {
		const sub = fromCodeSubscription({ id: 's', url, events: [] })
		await sendDelivery({
			subscription: sub,
			deliveryId: 'd2',
			event: 'posts.created',
			body: '{}',
			timeoutMs: 1000,
			now: 1,
		})
		expect(received?.headers['x-webhook-signature']).toBeUndefined()
	})

	it('plugin identity headers override custom headers with the same name', async () => {
		const sub = fromCodeSubscription({
			id: 's',
			url,
			events: [],
			headers: { 'X-Webhook-Id': 'attacker', 'X-Webhook-Event': 'fake.event' },
		})
		await sendDelivery({
			subscription: sub,
			deliveryId: 'd3',
			event: 'posts.created',
			body: '{}',
			timeoutMs: 1000,
			now: 1,
		})
		expect(received?.headers['x-webhook-id']).toBe('d3')
		expect(received?.headers['x-webhook-event']).toBe('posts.created')
	})
})
