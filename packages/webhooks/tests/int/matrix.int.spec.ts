import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { webhooks } from '../../src/index'

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
