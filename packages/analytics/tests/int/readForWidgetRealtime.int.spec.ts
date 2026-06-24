import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'
import { readForWidgetRealtime } from '../../src/widgets/readForWidgetRealtime'

describeForDb('readForWidgetRealtime', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})
	const req = () => ({ payload: booted.payload }) as unknown as PayloadRequest

	it('reads the active count and a minute series for the window', async () => {
		const now = new Date('2026-06-24T15:00:00.000Z')
		await booted.payload.create({
			collection: EVENTS_SLUG as never,
			data: {
				timestamp: new Date(now.getTime() - 60_000).toISOString(),
				type: 'pageview',
				path: '/p',
				hostname: 'h',
				visitorHash: 'v1',
				sessionId: 'v1',
			} as never,
		})
		const result = await readForWidgetRealtime({
			req: req(),
			metric: 'visitors',
			windowMinutes: 30,
			now,
		})
		expect(result.status).toBe('ok')
		expect(result.activeNow).toBe(1)
		expect(result.series.length).toBe(31)
	})
})
