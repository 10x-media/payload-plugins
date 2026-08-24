import { readEncryptedField } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import { type CollectionConfig, Forbidden, type Payload, type PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MAX_ROTATION_GRACE_SECONDS } from '../../src/constants'
import { webhooks } from '../../src/index'
import { resolveSecretRotationOptions } from '../../src/options'
import { generateSecret } from '../../src/secrets/format'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/**
 * The plaintext behind a stored secret, read the deliberate way the delivery path does. Nothing
 * else can see it: write-only storage strips the field from every ordinary read.
 */
const activeSecretOf = async (payload: Payload, id: string): Promise<string> => {
	const handle = await readEncryptedField(payload, {
		collection: 'webhook-subscriptions',
		id,
		path: 'secret',
	})
	return String(await handle?.decrypt())
}

describe('rotation hardening', () => {
	let booted: BootedPayload
	const activeSecret = (id: string) => activeSecretOf(booted.payload, id)

	const req = () => ({ context: {}, payload: booted.payload }) as unknown as PayloadRequest

	const rotate = (args: { id: string; secret?: string; graceSeconds: number }) =>
		rotateSubscriptionSecret({
			payload: booted.payload,
			req: req(),
			subscriptionsSlug: 'webhook-subscriptions',
			...args,
		})

	const subscribe = (name: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: 'https://example.test', enabled: true, events: [] },
			overrideAccess: true,
		})

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

	describe('grace period bounds', () => {
		it('rejects a window beyond the ceiling', () => {
			expect(() => resolveSecretRotationOptions({ graceSeconds: 1e12 })).toThrow(/at most/)
			expect(() =>
				resolveSecretRotationOptions({ graceSeconds: MAX_ROTATION_GRACE_SECONDS + 1 })
			).toThrow(/at most/)
		})

		it('accepts the ceiling itself', () => {
			expect(
				resolveSecretRotationOptions({ graceSeconds: MAX_ROTATION_GRACE_SECONDS }).graceSeconds
			).toBe(MAX_ROTATION_GRACE_SECONDS)
		})

		it('rejects non-finite and negative windows', () => {
			expect(() => resolveSecretRotationOptions({ graceSeconds: Number.NaN })).toThrow()
			expect(() =>
				resolveSecretRotationOptions({ graceSeconds: Number.POSITIVE_INFINITY })
			).toThrow()
			expect(() => resolveSecretRotationOptions({ graceSeconds: -1 })).toThrow()
		})

		it('keeps a bounded expiry within the ceiling when rotating', async () => {
			const created = await subscribe('bounded')
			const result = await rotate({
				id: String(created.id),
				graceSeconds: MAX_ROTATION_GRACE_SECONDS,
			})
			const expires = Date.parse(String(result.previousSecretExpiresAt))
			expect(expires - Date.now()).toBeLessThanOrEqual(MAX_ROTATION_GRACE_SECONDS * 1000 + 5_000)
			expect(new Date(expires).getUTCFullYear()).toBeLessThan(new Date().getUTCFullYear() + 2)
		})
	})

	describe('concurrent rotation', () => {
		it('does not hand out a secret that never signs', async () => {
			const created = await subscribe('concurrent')
			const id = String(created.id)

			const results = await Promise.allSettled([
				rotate({ id, graceSeconds: 3600 }),
				rotate({ id, graceSeconds: 3600 }),
			])

			const fulfilled = results.filter((r) => r.status === 'fulfilled')
			expect(fulfilled.length).toBeGreaterThanOrEqual(1)

			// Whichever rotations reported success must have left the active secret as one of the
			// values they returned: a caller is never told a secret is theirs when it was discarded.
			const active = await activeSecret(id)
			const promised = fulfilled.map((r) => (r.status === 'fulfilled' ? r.value.secret : undefined))
			expect(promised).toContain(active)
		})

		it('leaves the subscription readable, and its secret still recoverable, after a contended rotation', async () => {
			const created = await subscribe('contended')
			const id = String(created.id)
			await Promise.allSettled([rotate({ id, graceSeconds: 60 }), rotate({ id, graceSeconds: 60 })])
			const reread = await booted.payload.findByID({
				collection: 'webhook-subscriptions',
				id,
				overrideAccess: true,
			})
			// Write-only storage strips the field from the read; the set indicator is what says a
			// usable secret is still in place.
			expect(reread.secret).toBeUndefined()
			expect(reread.secret_set).toBe(true)
			expect(await activeSecret(id)).toMatch(/^whsec_/)
		})
	})
})

/**
 * These drive the registered handler itself rather than `rotateSubscriptionSecret` underneath it,
 * because the guards under test (authorization, body validation, status mapping) live only in the
 * handler. Asserting that the endpoint is registered and that the collection has an access function
 * would leave every one of them unexercised.
 */
describe('the rotate-secret endpoint handler', () => {
	let booted: BootedPayload
	const activeSecret = (id: string) => activeSecretOf(booted.payload, id)

	const handler = () => {
		const endpoints = booted.payload.collections?.['webhook-subscriptions']?.config?.endpoints
		const endpoint = (Array.isArray(endpoints) ? endpoints : []).find(
			(e) => e.path === '/:id/rotate-secret' && e.method === 'post'
		)
		if (!endpoint) {
			throw new Error('rotate-secret endpoint is not registered')
		}
		return endpoint.handler
	}

	/** A request shaped like the one Payload hands a custom endpoint. */
	const request = (args: {
		id?: string
		user?: unknown
		body?: unknown
		access?: (args: unknown) => unknown
	}) => {
		const collection = booted.payload.collections?.['webhook-subscriptions']
		if (args.access && collection) {
			// biome-ignore lint/suspicious/noExplicitAny: swapping the configured access for one case
			;(collection.config.access as any).update = args.access
		}
		return {
			context: {},
			json: () => Promise.resolve(args.body ?? {}),
			payload: booted.payload,
			routeParams: args.id === undefined ? {} : { id: args.id },
			user: 'user' in args ? args.user : { collection: 'users', id: 'u1' },
		} as never
	}

	const call = async (args: Parameters<typeof request>[0]) => {
		const res = await handler()(request(args))
		return { body: (await res.json()) as Record<string, unknown>, status: res.status }
	}

	/**
	 * Captured once and restored after every case, so a failing assertion cannot leave a swapped
	 * access function behind for the tests that follow.
	 */
	let configuredAccess: unknown

	const subscribe = async (name: string) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: 'https://example.test', enabled: true, events: [] },
			overrideAccess: true,
		})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
		})
		configuredAccess = booted.payload.collections?.['webhook-subscriptions']?.config?.access?.update
	})

	afterEach(() => {
		const collection = booted.payload.collections?.['webhook-subscriptions']
		if (collection) {
			// biome-ignore lint/suspicious/noExplicitAny: restoring the collection's own access
			;(collection.config.access as any).update = configuredAccess
		}
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('rotates and reveals the new secret once for a permitted caller', async () => {
		const created = await subscribe('endpoint-ok')
		const { status, body } = await call({ id: String(created.id) })
		expect(status).toBe(200)
		expect(String(body.secret)).toMatch(/^whsec_/)
		expect(body.previousSecretExpiresAt).toBeTruthy()
	})

	it('refuses an anonymous caller with 401', async () => {
		const created = await subscribe('endpoint-anon')
		expect(await call({ id: String(created.id), user: undefined })).toMatchObject({ status: 401 })
	})

	it('rejects a missing id with 400', async () => {
		expect(await call({})).toMatchObject({ status: 400 })
	})

	it('returns 403 when the collection update access denies this document', async () => {
		const created = await subscribe('endpoint-denied')
		const { status } = await call({ access: () => false, id: String(created.id) })
		expect(status).toBe(403)
	})

	it('returns 403 when the access function throws Forbidden rather than returning false', async () => {
		const created = await subscribe('endpoint-throws')
		const { status } = await call({
			access: () => {
				throw new Forbidden()
			},
			id: String(created.id),
		})
		expect(status).toBe(403)
	})

	it('honours a Where result by checking the document matches it', async () => {
		const mine = await subscribe('endpoint-mine')
		const theirs = await subscribe('endpoint-theirs')
		const scoped = () => ({ name: { equals: 'endpoint-mine' } })

		const allowed = await call({ access: scoped, id: String(mine.id) })
		const denied = await call({ access: scoped, id: String(theirs.id) })
		expect(allowed.status).toBe(200)
		expect(denied.status).toBe(403)
	})

	it('rejects a non-numeric graceSeconds with 400 instead of silently retiring the old secret', async () => {
		const created = await subscribe('endpoint-nan')
		const { status, body } = await call({
			body: { graceSeconds: '3600' },
			id: String(created.id),
		})
		expect(status).toBe(400)
		expect(String(body.error)).toMatch(/finite number/)
	})

	it('rejects a graceSeconds beyond the ceiling with 400', async () => {
		const created = await subscribe('endpoint-huge')
		const { status, body } = await call({ body: { graceSeconds: 1e12 }, id: String(created.id) })
		expect(status).toBe(400)
		expect(String(body.error)).toMatch(/at most/)
	})

	it('rejects a non-string secret with 400', async () => {
		const created = await subscribe('endpoint-badtype')
		expect(await call({ body: { secret: 42 }, id: String(created.id) })).toMatchObject({
			status: 400,
		})
	})

	it('rejects a malformed secret with 400 and leaves the subscription alone', async () => {
		const created = await subscribe('endpoint-badsecret')
		const { status, body } = await call({
			body: { secret: 'not base64!' },
			id: String(created.id),
		})
		expect(status).toBe(400)
		expect(String(body.error)).toMatch(/invalid signing secret/)

		expect(await activeSecret(String(created.id))).toMatch(/^whsec_/)
	})

	it('accepts a customer-supplied secret and returns it', async () => {
		const created = await subscribe('endpoint-supplied')
		const chosen = generateSecret()
		const { status, body } = await call({ body: { secret: chosen }, id: String(created.id) })
		expect(status).toBe(200)
		expect(body.secret).toBe(chosen)
	})

	it('accepts graceSeconds: 0 and retires the old secret immediately', async () => {
		const created = await subscribe('endpoint-zero')
		const { status, body } = await call({ body: { graceSeconds: 0 }, id: String(created.id) })
		expect(status).toBe(200)
		expect(body.previousSecretExpiresAt).toBeNull()
	})
})
