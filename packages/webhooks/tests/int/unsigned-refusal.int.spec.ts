import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CIPHER_PREFIX } from '../../src/constants'
import { encryptExistingSecrets, webhooks } from '../../src/index'
import { generateSecret } from '../../src/secrets/format'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

/** A legacy pre-encryption secret: plaintext, unprefixed, untagged. */
const LEGACY_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

/** Tagged as ciphertext but not decryptable under this instance's key. */
const CORRUPT_CIPHERTEXT = `${CIPHER_PREFIX}${'0'.repeat(32)}${'ab'.repeat(40)}`

describe('a secret that cannot be recovered fails the delivery', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: Hit[] = []

	const raw = () => {
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

	const subscribe = async (name: string, storedSecret?: string) => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: sinkUrl, enabled: true, events: ['posts.created'] },
			overrideAccess: true,
		})
		if (storedSecret !== undefined) {
			await raw().updateOne({ name }, { $set: { secret: storedSecret } })
		}
		return created
	}

	const deliver = async (title: string) => {
		hits = []
		await booted.payload.create({ collection: 'posts', data: { title }, overrideAccess: true })
		const deliveries = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
			sort: '-createdAt',
			limit: 1,
		})
		return { hit: hits[0], delivery: deliveries.docs[0] }
	}

	const clear = async () => {
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

	it('never POSTs when the stored ciphertext cannot be decrypted', async () => {
		await clear()
		await subscribe('corrupt', CORRUPT_CIPHERTEXT)

		const { hit, delivery } = await deliver('corrupt')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
		expect(String(delivery?.error)).toMatch(/could not be decrypted/)
	})

	it('never POSTs an unmigrated legacy plaintext secret unsigned', async () => {
		await clear()
		await subscribe('legacy', LEGACY_SECRET)

		const { hit, delivery } = await deliver('legacy')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
		expect(String(delivery?.error)).toMatch(/could not be decrypted/)
	})

	it('delivers signed again once the legacy row is migrated', async () => {
		await clear()
		await subscribe('recovered', LEGACY_SECRET)
		await encryptExistingSecrets(booted.payload)

		const { hit, delivery } = await deliver('recovered')
		expect(hit?.headers['webhook-signature']).toMatch(/^v1,/)
		expect(delivery?.status).toBe('success')
	})

	it('delivers signed again after rotating a broken subscription', async () => {
		await clear()
		const created = await subscribe('rotated', CORRUPT_CIPHERTEXT)

		const res = await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: { secret: generateSecret() },
			overrideAccess: true,
		})
		expect(res.id).toBeTruthy()

		const { hit, delivery } = await deliver('rotated')
		expect(hit?.headers['webhook-signature']).toMatch(/^v1,/)
		expect(delivery?.status).toBe('success')
	})

	it('still sends unsigned when a subscription legitimately has no secret', async () => {
		await clear()
		await subscribe('secretless')
		await raw().updateOne({ name: 'secretless' }, { $unset: { secret: '' } })

		const { hit, delivery } = await deliver('secretless')
		expect(hit).toBeDefined()
		expect(hit?.headers['webhook-signature']).toBeUndefined()
		expect(delivery?.status).toBe('success')
	})

	it('marks the row dead through the queue path too', async () => {
		const queued = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'queue', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
		})
		try {
			const created = await queued.payload.create({
				collection: 'webhook-subscriptions',
				data: { name: 'queued', url: sinkUrl, enabled: true, events: ['posts.created'] },
				overrideAccess: true,
			})
			const { connection } = queued.payload.db as unknown as {
				connection: {
					collection: (name: string) => {
						updateOne: (f: Record<string, unknown>, u: Record<string, unknown>) => Promise<unknown>
					}
				}
			}
			await connection
				.collection('webhook-subscriptions')
				.updateOne({ name: 'queued' }, { $set: { secret: CORRUPT_CIPHERTEXT } })
			expect(created.id).toBeTruthy()

			hits = []
			await queued.payload.create({
				collection: 'posts',
				data: { title: 'queued' },
				overrideAccess: true,
			})
			await queued.payload.jobs.run()

			expect(hits).toHaveLength(0)
			const deliveries = await queued.payload.find({
				collection: 'webhook-deliveries',
				overrideAccess: true,
			})
			expect(deliveries.docs[0]?.status).toBe('dead')
			expect(String(deliveries.docs[0]?.error)).toMatch(/could not be decrypted/)
		} finally {
			await queued.stop()
		}
	})
})

describe('previousSecret cannot be injected on create', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const rawRow = async (name: string) => {
		const { connection } = booted.payload.db as unknown as {
			connection: {
				collection: (n: string) => {
					findOne: (f: Record<string, unknown>) => Promise<Record<string, unknown> | null>
				}
			}
		}
		return connection.collection('webhook-subscriptions').findOne({ name })
	}

	// `overrideAccess: false` is what makes this the REST/GraphQL path: the local API defaults it
	// to true, which bypasses field access and would not exercise the guard at all.
	it('drops a previousSecret supplied by an ordinary create', async () => {
		const injected = generateSecret()
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'injected',
				url: 'https://example.test',
				events: [],
				previousSecret: injected,
				previousSecretExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			},
			overrideAccess: false,
			user: { id: 'someone', collection: 'users' } as never,
		})

		const row = await rawRow('injected')
		expect(row?.previousSecret ?? null).toBeNull()
		expect(row?.previousSecretExpiresAt ?? null).toBeNull()
		expect(JSON.stringify(row)).not.toContain(injected.slice('whsec_'.length))
	})

	it('encrypts previousSecret even on a privileged create that bypasses field access', async () => {
		const injected = generateSecret()
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'privileged',
				url: 'https://example.test',
				events: [],
				previousSecret: injected,
			},
			overrideAccess: true,
		})

		const row = await rawRow('privileged')
		expect(String(row?.previousSecret).startsWith(CIPHER_PREFIX)).toBe(true)
		expect(JSON.stringify(row)).not.toContain(injected.slice('whsec_'.length))
	})
})
