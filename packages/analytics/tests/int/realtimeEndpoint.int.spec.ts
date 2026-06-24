import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
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
})
