import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { makeRealtimeHandler } from '../../src/plugin/realtimeEndpoint'

describeForDb('realtime endpoint', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})
	const handler = makeRealtimeHandler()
	const reqFor = (url: string, user: unknown) =>
		({ url, user, payload: booted.payload }) as unknown as PayloadRequest

	it('401s without an authenticated user, and no cache may hold that answer either', async () => {
		const res = await handler(
			reqFor('http://x/api/analytics/realtime?metric=visitors&windowMinutes=30', null)
		)
		expect(res.status).toBe(401)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})

	it('returns the realtime payload for an authenticated user', async () => {
		const res = await handler(
			reqFor('http://x/api/analytics/realtime?metric=visitors&windowMinutes=30', { id: '1' })
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { status: string; activeNow: number; series: unknown[] }
		expect(body.status).toBe('ok')
		expect(Array.isArray(body.series)).toBe(true)
	})

	it('clamps an out-of-allowlist windowMinutes to the default', async () => {
		const res = await handler(
			reqFor('http://x/api/analytics/realtime?metric=visitors&windowMinutes=9999', { id: '1' })
		)
		const body = (await res.json()) as { series: unknown[] }
		expect(body.series.length).toBe(31)
	})

	it('never lets a shared cache hold a reading', async () => {
		const res = await handler(
			reqFor('http://x/api/analytics/realtime?metric=visitors&windowMinutes=30', { id: '1' })
		)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})
})

describeForDb('realtime endpoint access control', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				access: {
					read: ({ req }) => {
						const email = (req.user as { email?: string } | null)?.email
						if (email === 'broken@t.dev') {
							throw new Error('access resolver is misconfigured')
						}
						return email === 'allowed@t.dev'
					},
				},
			}),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	const call = (email: string) =>
		makeRealtimeHandler()({
			url: 'http://x/api/analytics/realtime?metric=visitors&windowMinutes=30',
			user: { id: '1', email },
			payload: booted.payload,
		} as unknown as PayloadRequest)

	it('403s a reader access.read denies, and keeps that answer out of every cache', async () => {
		const res = await call('denied@t.dev')
		expect(res.status).toBe(403)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})

	// A gate that throws is a configuration bug: polling again cannot resolve it, so it is
	// not the retryable 503 a provider outage gets.
	it('500s when the access resolver throws rather than telling the poller to retry', async () => {
		const res = await call('broken@t.dev')
		expect(res.status).toBe(500)
		expect(res.headers.get('retry-after')).toBeNull()
		const body = (await res.json()) as { error: { code: string } }
		expect(body.error.code).toBe('internal')
	})
})

/** A source whose realtime read always rejects, the way a provider outage arrives. */
const failingRealtime = (): AnalyticsAdapter => {
	const base = native()
	return {
		...base,
		id: 'failing',
		label: 'Failing source',
		isConfigured: () => true,
		realtime: () => Promise.reject(new Error('provider is down')),
	}
}

describeForDb('realtime endpoint with a failing source', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [failingRealtime()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	// The widget polls this every few seconds: an outage is a retryable answer, not a 500.
	it('answers a retryable 503 rather than throwing', async () => {
		const res = await makeRealtimeHandler()({
			url: 'http://x/api/analytics/realtime?metric=visitors&windowMinutes=30',
			user: { id: '1' },
			payload: booted.payload,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(503)
		expect(res.headers.get('retry-after')).toBe('30')
		expect(res.headers.get('cache-control')).toBe('private, no-store')
		const body = (await res.json()) as { error: { code: string } }
		expect(body.error.code).toBe('unavailable')
	})
})
