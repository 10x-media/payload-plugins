import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_ROTATION_GRACE_SECONDS, SECRET_MASK } from '../../src/constants'
import { webhooks } from '../../src/index'
import { resolveSecretRotationOptions } from '../../src/options'
import { rotateSubscriptionSecret } from '../../src/secrets/rotate'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

describe('rotation hardening', () => {
	let booted: BootedPayload

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
			const active = await booted.payload.findByID({
				collection: 'webhook-subscriptions',
				id,
				overrideAccess: true,
				context: { webhooksRevealSecretForSigning: true },
			})
			const promised = fulfilled.map((r) => (r.status === 'fulfilled' ? r.value.secret : undefined))
			expect(promised).toContain(active.secret)
		})

		it('leaves the subscription readable and masked after a contended rotation', async () => {
			const created = await subscribe('contended')
			const id = String(created.id)
			await Promise.allSettled([rotate({ id, graceSeconds: 60 }), rotate({ id, graceSeconds: 60 })])
			const reread = await booted.payload.findByID({
				collection: 'webhook-subscriptions',
				id,
				overrideAccess: true,
			})
			expect(reread.secret).toBe(SECRET_MASK)
		})
	})
})

describe('rotate-secret endpoint respects collection update access', () => {
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

	it('exposes the collection update access the endpoint consults', () => {
		const access = booted.payload.collections?.['webhook-subscriptions']?.config?.access?.update
		expect(typeof access).toBe('function')
		expect(access?.({ req: { user: undefined } } as never)).toBe(false)
		expect(access?.({ req: { user: { id: '1' } } } as never)).toBe(true)
	})

	it('registers the rotate endpoint on the subscriptions collection', () => {
		const endpoints = booted.payload.collections?.['webhook-subscriptions']?.config?.endpoints
		const paths = Array.isArray(endpoints) ? endpoints.map((e) => e.path) : []
		expect(paths).toContain('/:id/rotate-secret')
	})
})
