import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { transport } from '../../src/delivery/destination'
import { webhooks } from '../../src/index'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/** Answers a lookup the way `dns.lookup` does, for whichever callback shape was asked for. */
const answering = (address: () => string) =>
	((
		_host: string,
		options: { all?: boolean },
		callback: (err: null, address: unknown, family?: number) => void
	) => {
		const value = address()
		if (options.all) {
			callback(null, [{ address: value, family: 4 }])
		} else {
			callback(null, value, 4)
		}
	}) as never

describe('the default URL policy', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkPort: number
	let hits = 0

	const subscribe = (url: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 's', url, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})

	/** The rows made for admin-managed subscriptions, leaving out the code subscription's. */
	const collectionDeliveries = async () =>
		(
			await booted.payload.find({
				collection: 'webhook-deliveries',
				where: { subscriptionSource: { equals: 'collection' } },
				overrideAccess: true,
			})
		).docs

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
		sinkPort = addr.port
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				subscriptions: [
					{ id: 'internal', url: `http://127.0.0.1:${sinkPort}/code`, events: ['posts.created'] },
				],
				delivery: { mode: 'inline', retries: 0 },
			}),
			db: 'mongo',
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		hits = 0
		await booted.payload.delete({
			collection: 'webhook-subscriptions',
			where: {},
			overrideAccess: true,
		})
		await booted.payload.delete({
			collection: 'webhook-deliveries',
			where: {},
			overrideAccess: true,
		})
	})

	it.each([
		'http://hooks.example.com/x',
		'https://127.0.0.1/x',
		'https://2130706433/x',
		'https://[::1]/x',
		'https://169.254.169.254/latest/meta-data',
	])('rejects %s on save', async (url) => {
		await expect(subscribe(url)).rejects.toThrow()
	})

	it('rejects, on save, a name that resolves to a private address', async () => {
		vi.spyOn(transport, 'lookup').mockImplementation(answering(() => '10.0.0.5'))
		await expect(subscribe('https://internal.example.com/x')).rejects.toThrow()
	})

	it('accepts a public https endpoint', async () => {
		vi.spyOn(transport, 'lookup').mockImplementation(answering(() => '93.184.216.34'))
		await expect(subscribe('https://hooks.example.com/x')).resolves.toBeDefined()
	})

	/** A row written before the policy existed, or past the form. */
	it('refuses a stored private endpoint at delivery time without sending', async () => {
		await booted.payload.db.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'legacy',
				url: `http://127.0.0.1:${sinkPort}/legacy`,
				enabled: true,
				events: ['posts.created'],
			},
		})
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		const rows = await collectionDeliveries()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.status).toBe('dead')
		expect(String(rows[0]?.error)).toMatch(/delivery\.allowHttp|allowPrivateAddresses/)
		// The code subscription on the same private address is trusted and did deliver.
		expect(hits).toBe(1)
	})

	/** Public when saved, private when the socket opens. */
	it('refuses at the socket when the name changes its answer after the save', async () => {
		let answer = '93.184.216.34'
		vi.spyOn(transport, 'lookup').mockImplementation(answering(() => answer))
		await subscribe('https://rebind.example.com/hook')
		answer = '127.0.0.1'
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'secret-title' },
			overrideAccess: true,
		})
		const row = (await collectionDeliveries())[0]
		expect(row?.status).toBe('dead')
		expect(String(row?.error)).toMatch(/non-public address/)
		expect(String(row?.error)).not.toContain('secret-title')
	})

	it('still delivers to a code subscription on a private address', async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		expect(hits).toBe(1)
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
		})
		expect(rows.docs).toHaveLength(1)
		expect(rows.docs[0]?.status).toBe('success')
	})
})
