import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string; path: string }

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
			hits.push({ headers: req.headers, body, path: req.url ?? '' })
			if ((req.url ?? '').includes('boom')) {
				res.writeHead(500)
				res.end('no')
				return
			}
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
})

afterAll(async () => {
	await new Promise<void>((r) => sink.close(() => r()))
})

const boot = (delivery: 'inline' | 'queue', retries = 4): Promise<BootedPayload> =>
	bootPayload({
		plugin: webhooks({ collections: { posts: true }, delivery: { mode: delivery, retries } }),
		db: 'mongo',
		collections: [posts],
	})

describe('outbound delivery (inline)', () => {
	let booted: BootedPayload
	beforeAll(async () => {
		hits = []
		booted = await boot('inline')
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'sink', url: `${sinkUrl}/in`, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('delivers a signed POST and records success', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Hello' },
			overrideAccess: true,
		})
		expect(hits.length).toBe(1)
		expect(hits[0]?.headers['x-webhook-event']).toBe('posts.created')
		expect(hits[0]?.headers['x-webhook-signature']).toMatch(/^v1=[0-9a-f]{64}$/)
		const body = JSON.parse(hits[0]?.body ?? '')
		expect(body.event).toBe('posts.created')
		expect(body.data.title).toBe('Hello')

		const deliveries = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(deliveries.docs).toHaveLength(1)
		expect(deliveries.docs[0]?.status).toBe('success')
	})

	it('does not deliver for disabled subscriptions', async () => {
		hits = []
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			where: { name: { equals: 'sink' } },
			data: { enabled: false },
			overrideAccess: true,
		})
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Quiet' },
			overrideAccess: true,
		})
		expect(hits.length).toBe(0)
	})

	it('never emits for its own deliveries collection (loop guard)', async () => {
		hits = []
		const before = (
			await booted.payload.find({ collection: 'webhook-deliveries', overrideAccess: true })
		).totalDocs
		await booted.payload.update({
			collection: 'webhook-deliveries',
			where: {},
			data: { responseBody: 'touched' },
			overrideAccess: true,
		})
		const after = (
			await booted.payload.find({ collection: 'webhook-deliveries', overrideAccess: true })
		).totalDocs
		expect(after).toBe(before)
		expect(hits.length).toBe(0)
	})
})

describe('outbound delivery (queued)', () => {
	let booted: BootedPayload
	beforeAll(async () => {
		hits = []
		booted = await boot('queue')
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'q', url: `${sinkUrl}/q`, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('enqueues then delivers on run()', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Queued' },
			overrideAccess: true,
		})
		expect(hits.length).toBe(0)
		const pending = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(pending.docs[0]?.status).toBe('pending')

		await booted.payload.jobs.run()
		expect(hits.length).toBe(1)
		const done = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(done.docs[0]?.status).toBe('success')
		expect(done.docs[0]?.attempt).toBe(1)
	})
})

describe('outbound delivery failure (queued, retries=0)', () => {
	let booted: BootedPayload
	beforeAll(async () => {
		hits = []
		booted = await boot('queue', 0)
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'bad', url: `${sinkUrl}/boom`, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('marks the delivery dead after the single attempt', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'Fail' },
			overrideAccess: true,
		})
		await booted.payload.jobs.run()
		const done = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(done.docs[0]?.status).toBe('dead')
		expect(done.docs[0]?.attempt).toBe(1)
		expect(done.docs[0]?.responseStatus).toBe(500)
	})
})
