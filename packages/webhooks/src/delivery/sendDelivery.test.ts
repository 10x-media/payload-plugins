import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MESSAGE_ID_PREFIX } from '../constants'
import { fromCodeSubscription } from '../plugin/resolveSubscriptions'
import { generateSecret } from '../secrets/format'
import { sendDelivery } from './sendDelivery'
import { signatureHeader, signPayload } from './sign'

let server: Server
let url: string
type Hit = { headers: IncomingHttpHeaders; body: string }
let received: Hit | undefined
/** Read through a call so assigning `undefined` above does not narrow the variable away. */
const lastHit = (): Hit | undefined => received

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
		expect(received?.headers['webhook-id']).toBe(`${MESSAGE_ID_PREFIX}d1`)
		expect(received?.headers['webhook-timestamp']).toBe(String(timestamp))
		expect(received?.headers['webhook-signature']).toBe(
			signatureHeader([signPayload({ secret, id: `${MESSAGE_ID_PREFIX}d1`, timestamp, body })])
		)
		expect(received?.headers['x-custom']).toBe('c')
	})

	/** Send one delivery and hand back what the sink saw, so each case stands on its own. */
	const capture = async (event: string) => {
		received = undefined
		await sendDelivery({
			subscription: fromCodeSubscription({ id: 's', url, events: [], secret }),
			deliveryId: 'd_headers',
			event,
			body: '{"id":"d_headers"}',
			timeoutMs: 1000,
			now: 1_700_000_000_000,
		})
		const hit = lastHit()
		if (!hit) {
			throw new Error('no delivery captured')
		}
		return hit
	}

	it('retains X-Webhook-Event alongside the standard headers', async () => {
		const hit = await capture('posts.created')
		expect(hit.headers['x-webhook-event']).toBe('posts.created')
		expect(hit.headers['webhook-id']).toBe(`${MESSAGE_ID_PREFIX}d_headers`)
		expect(hit.headers['webhook-signature']).toMatch(/^v1,/)
	})

	it('no longer sends the pre-standard signing headers', async () => {
		const hit = await capture('posts.updated')
		expect(hit.headers['x-webhook-id']).toBeUndefined()
		expect(hit.headers['x-webhook-timestamp']).toBeUndefined()
		expect(hit.headers['x-webhook-signature']).toBeUndefined()
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
			`v1,${signPayload({ secret, id: `${MESSAGE_ID_PREFIX}d3`, timestamp, body })}`,
			`v1,${signPayload({ secret: older, id: `${MESSAGE_ID_PREFIX}d3`, timestamp, body })}`,
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
			signatureHeader([
				signPayload({
					secret,
					id: `${MESSAGE_ID_PREFIX}d4`,
					timestamp: Math.floor(now / 1000),
					body,
				}),
			])
		)
	})

	it('refuses to let a custom header clobber the signature it just computed', async () => {
		const sub = {
			...fromCodeSubscription({ id: 's', url, events: [], secret }),
			headers: {
				'Content-Type': 'text/plain',
				'User-Agent': 'not-us',
				'Webhook-Signature': 'v1,forged',
				'webhook-id': 'spoofed',
				'X-Kept': 'yes',
			},
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
		expect(received?.headers['webhook-id']).toBe(`${MESSAGE_ID_PREFIX}d5`)
		expect(received?.headers['webhook-signature']).toBe(
			signatureHeader([
				signPayload({
					secret,
					id: `${MESSAGE_ID_PREFIX}d5`,
					timestamp: Math.floor(now / 1000),
					body,
				}),
			])
		)
		expect(received?.headers['x-kept']).toBe('yes')
		// The body is always JSON.stringify output, so a subscription relabelling it would mislabel
		// every delivery it sends with nothing for the receiver to notice that with.
		expect(received?.headers['content-type']).toBe('application/json')
		expect(received?.headers['user-agent']).toBe('10x-media-webhooks')
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
		expect(received?.headers['webhook-id']).toBe(`${MESSAGE_ID_PREFIX}d2`)
	})
})
