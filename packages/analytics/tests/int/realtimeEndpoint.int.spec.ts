import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { makeRealtimeHandler } from '../../src/plugin/realtimeEndpoint'

describeForDb('realtime endpoint', { dbs: ['mongo'] }, (db) => {
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

	it('401s without an authenticated user', async () => {
		const res = await handler(
			reqFor('http://x/api/analytics/realtime?metric=visitors&windowMinutes=30', null)
		)
		expect(res.status).toBe(401)
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

describeForDb('realtime endpoint with a failing source', { dbs: ['mongo'] }, (db) => {
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
