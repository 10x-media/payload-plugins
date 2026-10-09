import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { isSealed } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }
const articles: CollectionConfig = {
	slug: 'articles',
	fields: [{ name: 'title', type: 'text' }],
	versions: { drafts: true },
}
const fragile: CollectionConfig = { slug: 'fragile', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

/**
 * A well-formed wire string whose tag does not verify under the configured key, which is what a
 * header value sealed under a key that has since left the ring looks like.
 */
const UNREADABLE = `pfe1.k0.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`

describe('dispatch hardening', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: Hit[] = []

	const rawSubscriptions = () => {
		const { connection } = booted.payload.db as unknown as {
			connection: {
				collection: (name: string) => {
					findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>
					updateOne: (
						filter: Record<string, unknown>,
						update: Record<string, unknown>
					) => Promise<unknown>
				}
			}
		}
		return connection.collection('webhook-subscriptions')
	}

	const subscribe = (name: string, data: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name,
				url: sinkUrl,
				enabled: true,
				events: ['posts.created', 'posts.updated', 'articles.created', 'articles.updated'],
				...data,
			},
			overrideAccess: true,
		})

	const deliveries = async () =>
		(
			await booted.payload.find({
				collection: 'webhook-deliveries',
				overrideAccess: true,
				sort: '-createdAt',
			})
		).docs

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
			plugin: webhooks({
				collections: {
					posts: true,
					articles: { includeDrafts: false },
					fragile: {
						transform: () => {
							throw new Error('transform blew up')
						},
					},
				},
				delivery: { mode: 'inline', retries: 0 },
			}),
			db: 'mongo',
			collections: [posts, articles, fragile],
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	beforeEach(() => {
		hits = []
	})

	afterEach(async () => {
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

	describe('which writes emit', () => {
		/**
		 * On an autosave collection the admin saves every time the editor pauses. Emitting for those
		 * would send a stream of half-typed documents; the deliberate save that follows emits.
		 */
		it('stays silent for an autosave and emits for the deliberate save', async () => {
			await subscribe('autosave')
			const post = await booted.payload.create({
				collection: 'posts',
				data: { title: 'first' },
				overrideAccess: true,
			})
			hits = []

			await booted.payload.update({
				collection: 'posts',
				id: post.id,
				data: { title: 'typing' },
				overrideAccess: true,
				req: { query: { autosave: 'true' } } as unknown as PayloadRequest,
			})
			expect(hits).toHaveLength(0)

			await booted.payload.update({
				collection: 'posts',
				id: post.id,
				data: { title: 'saved' },
				overrideAccess: true,
			})
			expect(hits).toHaveLength(1)
			expect(JSON.parse(hits[0]?.body ?? '{}').data.title).toBe('saved')
		})

		it('keeps draft saves from leaving a collection that opted out, and emits on publish', async () => {
			await subscribe('drafts')
			const article = await booted.payload.create({
				collection: 'articles',
				data: { title: 'unpublished' },
				draft: true,
				overrideAccess: true,
			})
			expect(hits).toHaveLength(0)

			await booted.payload.update({
				collection: 'articles',
				id: article.id,
				data: { _status: 'published', title: 'published' } as never,
				overrideAccess: true,
			})
			expect(hits).toHaveLength(1)
			expect(JSON.parse(hits[0]?.body ?? '{}').data._status).toBe('published')
		})
	})

	/**
	 * A webhook is a side effect of the write. A `transform` that throws is the consumer's bug to
	 * read about in the log, not a failed save for the editor, and it must not leave a delivery
	 * row behind that nothing will ever send.
	 */
	it('does not fail the write, or leave a row, when the transform throws', async () => {
		await subscribe('fragile', { events: ['fragile.created'] })
		const created = await booted.payload.create({
			collection: 'fragile',
			data: { title: 'still saved' },
			overrideAccess: true,
		})
		expect(created.title).toBe('still saved')
		expect(hits).toHaveLength(0)
		expect(await deliveries()).toHaveLength(0)
	})

	it('records which registry a delivery subscription came from', async () => {
		await subscribe('source')
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		expect((await deliveries())[0]?.subscriptionSource).toBe('collection')
	})

	describe('custom header values', () => {
		const withAuth = (name: string) =>
			subscribe(name, { headers: [{ key: 'Authorization', value: 'Bearer receiver-t0ken' }] })

		/** This is where a receiver's own credential goes, so it gets the secret's treatment at rest. */
		it('is sealed at rest and sent in the clear to the receiver', async () => {
			await withAuth('auth')
			const raw = await rawSubscriptions().findOne({ name: 'auth' })
			const stored = (raw?.headers as { value: unknown }[])[0]?.value
			expect(isSealed(stored)).toBe(true)
			expect(JSON.stringify(raw)).not.toContain('receiver-t0ken')

			await booted.payload.create({
				collection: 'posts',
				data: { title: 'x' },
				overrideAccess: true,
			})
			expect(hits[0]?.headers.authorization).toBe('Bearer receiver-t0ken')
			expect(hits[0]?.headers['webhook-signature']).toMatch(/^v1,/)
		})

		it('still sends a header value stored before encryption, as it was', async () => {
			await withAuth('legacy')
			await rawSubscriptions().updateOne(
				{ name: 'legacy' },
				{ $set: { 'headers.0.value': 'Bearer plain-legacy' } }
			)
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'x' },
				overrideAccess: true,
			})
			expect(hits[0]?.headers.authorization).toBe('Bearer plain-legacy')
		})

		/**
		 * The admin reads the value back and resubmits it on every save. Read as null, the save would
		 * write null over the receiver's credential; read as it is, the save seals it.
		 */
		it('reads a header value stored before encryption back as it is, and seals it on save', async () => {
			const created = await withAuth('legacy-save')
			await rawSubscriptions().updateOne(
				{ name: 'legacy-save' },
				{ $set: { 'headers.0.value': 'Bearer plain-legacy' } }
			)
			const read = await booted.payload.findByID({
				collection: 'webhook-subscriptions',
				id: created.id,
				overrideAccess: true,
			})
			expect(read.headers?.[0]?.value).toBe('Bearer plain-legacy')

			await booted.payload.update({
				collection: 'webhook-subscriptions',
				id: created.id,
				data: { headers: read.headers },
				overrideAccess: true,
			})
			const raw = await rawSubscriptions().findOne({ name: 'legacy-save' })
			expect(isSealed((raw?.headers as { value: unknown }[])[0]?.value)).toBe(true)

			await booted.payload.create({
				collection: 'posts',
				data: { title: 'x' },
				overrideAccess: true,
			})
			expect(hits[0]?.headers.authorization).toBe('Bearer plain-legacy')
		})

		/** Sending without it, or sending the ciphertext, are both worse than not sending. */
		it('refuses the delivery when a sealed value cannot be decrypted', async () => {
			await withAuth('unreadable')
			await rawSubscriptions().updateOne(
				{ name: 'unreadable' },
				{ $set: { 'headers.0.value': UNREADABLE } }
			)
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'x' },
				overrideAccess: true,
			})
			expect(hits).toHaveLength(0)
			const [delivery] = await deliveries()
			expect(delivery?.status).toBe('dead')
			expect(String(delivery?.error)).toMatch(/custom header value could not be decrypted/)
		})

		it('rejects a value carrying a line break, which fetch would refuse at delivery time', async () => {
			await expect(
				subscribe('crlf', { headers: [{ key: 'X-Trace', value: 'a\r\nInjected: 1' }] })
			).rejects.toThrow()
		})

		it('stores a padded header name trimmed, as it was validated', async () => {
			const created = await subscribe('padded', { headers: [{ key: '  X-Padded ', value: '1' }] })
			expect(created.headers?.[0]?.key).toBe('X-Padded')
		})
	})

	describe('the redeliver endpoint', () => {
		const call = async (args: { id: string; read?: (args: unknown) => unknown }) => {
			const collection = booted.payload.collections?.['webhook-deliveries']
			const endpoints = collection?.config?.endpoints
			const endpoint = (Array.isArray(endpoints) ? endpoints : []).find(
				(e) => e.path === '/:id/redeliver' && e.method === 'post'
			)
			if (!collection || !endpoint) {
				throw new Error('redeliver endpoint is not registered')
			}
			const configured = collection.config.access.read
			if (args.read) {
				// biome-ignore lint/suspicious/noExplicitAny: swapping the configured access for one case
				;(collection.config.access as any).read = args.read
			}
			try {
				const res = await endpoint.handler({
					context: {},
					payload: booted.payload,
					routeParams: { id: args.id },
					user: { collection: 'users', id: 'u1' },
				} as never)
				return res.status
			} finally {
				collection.config.access.read = configured
			}
		}

		const delivered = async () => {
			await subscribe('redeliver')
			await booted.payload.create({
				collection: 'posts',
				data: { title: 'x' },
				overrideAccess: true,
			})
			hits = []
			return String((await deliveries())[0]?.id)
		}

		it('replays a delivery the caller may read', async () => {
			expect(await call({ id: await delivered() })).toBe(202)
			expect(hits).toHaveLength(1)
		})

		/**
		 * The collection denies create and update to everyone, so `read` is the rule an override
		 * scopes. A log scoped per tenant has to scope the replay with it.
		 */
		it('refuses a delivery the collection read access hides from the caller', async () => {
			const id = await delivered()
			expect(await call({ id, read: () => false })).toBe(403)
			expect(await call({ id, read: () => ({ event: { equals: 'someone.elses' } }) })).toBe(404)
			expect(hits).toHaveLength(0)
		})
	})
})
