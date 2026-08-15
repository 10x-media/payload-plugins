import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromCodeSubscription } from '../plugin/resolveSubscriptions'
import { generateSecret } from '../secrets/format'
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
	const secret = generateSecret()

	it('sets the Standard Webhooks headers and signs id.timestamp.body', async () => {
		const sub = fromCodeSubscription({
			id: 's',
			url,
			events: [],
			secret,
			headers: { 'X-Custom': 'c' },
		})
		const body = '{"id":"d1"}'
		const now = 1_700_000_000_000
		const timestamp = Math.floor(now / 1000)
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
		expect(received?.headers['webhook-id']).toBe('d1')
		expect(received?.headers['webhook-timestamp']).toBe(String(timestamp))
		expect(received?.headers['webhook-signature']).toBe(
			signatureHeader([signPayload({ secret, id: 'd1', timestamp, body })])
		)
		expect(received?.headers['x-custom']).toBe('c')
	})

	it('retains X-Webhook-Event alongside the standard headers', async () => {
		expect(received?.headers['x-webhook-event']).toBe('posts.created')
	})

	it('no longer sends the pre-standard signing headers', async () => {
		expect(received?.headers['x-webhook-id']).toBeUndefined()
		expect(received?.headers['x-webhook-timestamp']).toBeUndefined()
		expect(received?.headers['x-webhook-signature']).toBeUndefined()
	})

	it('emits one v1 signature per secret, space separated', async () => {
		const older = generateSecret()
		const sub = { ...fromCodeSubscription({ id: 's', url, events: [] }), secrets: [secret, older] }
		const body = '{"id":"d3"}'
		const now = 1_700_000_500_000
		const timestamp = Math.floor(now / 1000)
		await sendDelivery({
			subscription: sub,
			deliveryId: 'd3',
			event: 'posts.updated',
			body,
			timeoutMs: 1000,
			now,
		})
		const header = String(received?.headers['webhook-signature'])
		expect(header.split(' ')).toEqual([
			`v1,${signPayload({ secret, id: 'd3', timestamp, body })}`,
			`v1,${signPayload({ secret: older, id: 'd3', timestamp, body })}`,
		])
	})

	it('signs the body bytes it sends, unchanged', async () => {
		const body = '{"spacing":  1,"unicode":"café"}'
		const now = 1_700_000_900_000
		await sendDelivery({
			subscription: fromCodeSubscription({ id: 's', url, events: [], secret }),
			deliveryId: 'd4',
			event: 'posts.created',
			body,
			timeoutMs: 1000,
			now,
		})
		expect(received?.body).toBe(body)
		expect(received?.headers['webhook-signature']).toBe(
			signatureHeader([signPayload({ secret, id: 'd4', timestamp: Math.floor(now / 1000), body })])
		)
	})

	it('refuses to let a custom header clobber the signature it just computed', async () => {
		const sub = {
			...fromCodeSubscription({ id: 's', url, events: [], secret }),
			headers: { 'Webhook-Signature': 'v1,forged', 'webhook-id': 'spoofed', 'X-Kept': 'yes' },
		}
		const body = '{"id":"d5"}'
		const now = 1_700_001_000_000
		await sendDelivery({
			subscription: sub,
			deliveryId: 'd5',
			event: 'posts.created',
			body,
			timeoutMs: 1000,
			now,
		})
		expect(received?.headers['webhook-id']).toBe('d5')
		expect(received?.headers['webhook-signature']).toBe(
			signatureHeader([signPayload({ secret, id: 'd5', timestamp: Math.floor(now / 1000), body })])
		)
		expect(received?.headers['x-kept']).toBe('yes')
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
		expect(received?.headers['webhook-signature']).toBeUndefined()
		expect(received?.headers['webhook-id']).toBe('d2')
	})
})
