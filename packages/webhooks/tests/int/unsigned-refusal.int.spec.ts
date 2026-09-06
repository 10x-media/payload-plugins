import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { isSealed } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptExistingSecrets, webhooks } from '../../src/index'
import { generateSecret } from '../../src/secrets/format'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

type Hit = { headers: IncomingHttpHeaders; body: string }

/** A legacy pre-encryption secret: plaintext, unprefixed, untagged. */
const LEGACY_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

/**
 * A well-formed wire string whose tag does not verify under the configured key: what a changed
 * `PAYLOAD_SECRET` leaves behind. `k0` is the default key id, so the ring has a key to try and the
 * failure is authentication rather than a missing key.
 */
const WRONG_KEY_CIPHERTEXT = `pfe1.k0.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`

/** Same shape, but sealed under a key id no longer in the ring. */
const UNKNOWN_KEY_CIPHERTEXT = `pfe1.retired.${'A'.repeat(16)}.${'B'.repeat(24)}.${'C'.repeat(22)}`

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

	/**
	 * Each of these needs a different fix, so each gets a different message. A single "could not be
	 * decrypted" would send an operator hunting the wrong one.
	 */
	it('never POSTs when no configured key authenticates the stored value', async () => {
		await clear()
		await subscribe('wrong-key', WRONG_KEY_CIPHERTEXT)

		const { hit, delivery } = await deliver('wrong-key')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
		expect(String(delivery?.error)).toMatch(/no configured key authenticates it/)
	})

	it('names the missing key when the value was sealed under one that is gone', async () => {
		await clear()
		await subscribe('unknown-key', UNKNOWN_KEY_CIPHERTEXT)

		const { hit, delivery } = await deliver('unknown-key')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
		expect(String(delivery?.error)).toMatch(/key id that is not in secretEncryption.keys/)
	})

	it('never POSTs an unmigrated legacy plaintext secret unsigned', async () => {
		await clear()
		await subscribe('legacy', LEGACY_SECRET)

		const { hit, delivery } = await deliver('legacy')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
		expect(String(delivery?.error)).toMatch(/encryptExistingSecrets/)
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
		const created = await subscribe('rotated', WRONG_KEY_CIPHERTEXT)

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

	/**
	 * The one way an unsigned subscription could be created by accident rather than on purpose.
	 * `encryptedField` reads a write-only empty string as a clear and stores null, so a create
	 * carrying `secret: ''` used to return 201 with no secret at all and deliver unsigned forever,
	 * which is the downgrade the whole refusal path exists to prevent. It has to fail at the create.
	 */
	it('refuses a create that supplies an empty secret rather than storing none', async () => {
		await clear()
		await expect(
			booted.payload.create({
				collection: 'webhook-subscriptions',
				data: { name: 'blank', url: sinkUrl, enabled: true, events: ['posts.created'], secret: '' },
				overrideAccess: true,
			} as never)
		).rejects.toThrow()

		const found = await booted.payload.find({
			collection: 'webhook-subscriptions',
			where: { name: { equals: 'blank' } },
			overrideAccess: true,
		})
		expect(found.docs).toHaveLength(0)
	})

	/**
	 * The refusal exists so a subscription meant to be signed is never sent unsigned. That reasoning
	 * covers the active secret only: when the retired one in an open grace window is unreadable, a
	 * fully valid signature is still available, and refusing would trade a correctly signed delivery
	 * for no delivery at all. This is the shape a `PAYLOAD_SECRET` change leaves behind when the
	 * operator restores `secret` but not `previousSecret`.
	 */
	it('delivers signed with the active secret when only the retired one is unreadable', async () => {
		await clear()
		await subscribe('half-broken')
		await raw().updateOne(
			{ name: 'half-broken' },
			{
				$set: {
					previousSecret: WRONG_KEY_CIPHERTEXT,
					previousSecretExpiresAt: new Date(Date.now() + 3_600_000),
				},
			}
		)

		const { hit, delivery } = await deliver('half-broken')
		expect(hit).toBeDefined()
		expect(delivery?.status).toBe('success')
		// One signature, from the active secret: the unreadable retired one is dropped, not signed.
		expect(String(hit?.headers['webhook-signature']).split(' ')).toHaveLength(1)
		expect(hit?.headers['webhook-signature']).toMatch(/^v1,/)
	})

	it('refuses when the active secret is unreadable even if a retired one still works', async () => {
		await clear()
		const created = await subscribe('active-broken')
		const usable = generateSecret()
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: {
				previousSecret: usable,
				previousSecretExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			},
			overrideAccess: true,
		})
		await raw().updateOne({ name: 'active-broken' }, { $set: { secret: WRONG_KEY_CIPHERTEXT } })

		const { hit, delivery } = await deliver('active-broken')
		expect(hit).toBeUndefined()
		expect(delivery?.status).toBe('dead')
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
				.updateOne({ name: 'queued' }, { $set: { secret: WRONG_KEY_CIPHERTEXT } })
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
				sort: '-createdAt',
				limit: 1,
			})
			expect(deliveries.docs[0]?.status).toBe('dead')
			expect(String(deliveries.docs[0]?.error)).toMatch(/no configured key authenticates it/)
		} finally {
			await queued.stop()
		}
	})
})

describe('the stored secrets are not editable through the API', () => {
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

	/**
	 * "You cannot change the secret except by rotating" is a security claim, so it is asserted
	 * against the stored row rather than against the field config. `overrideAccess: false` is what
	 * makes this the REST/GraphQL path.
	 */
	it('drops a secret an ordinary update tries to replace', async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'locked', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		const before = await rawRow('locked')

		const replacement = generateSecret()
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: { name: 'locked renamed', secret: replacement },
			overrideAccess: false,
			user: { id: 'someone', collection: 'users' } as never,
		})

		const after = await rawRow('locked renamed')
		expect(after?.secret).toBe(before?.secret)
		expect(JSON.stringify(after)).not.toContain(replacement.slice('whsec_'.length))
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
		expect(isSealed(row?.previousSecret)).toBe(true)
		expect(JSON.stringify(row)).not.toContain(injected.slice('whsec_'.length))
	})
})
