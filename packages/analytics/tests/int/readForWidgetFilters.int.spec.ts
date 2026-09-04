import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'

describeForDb('readForWidget filter pass-through', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})
	const req = () => ({ payload: booted.payload }) as unknown as PayloadRequest

	const recordEvent = (path: string, timestamp: string) =>
		booted.payload.create({
			collection: EVENTS_SLUG as never,
			data: {
				timestamp,
				type: 'pageview',
				path,
				hostname: 'h',
				visitorHash: `v-${path}`,
				sessionId: `s-${path}`,
			} as never,
		})

	it('narrows totals to the matching events against the native adapter', async () => {
		await recordEvent('/a', '2026-06-01T12:00:00.000Z')
		await recordEvent('/b', '2026-06-01T12:00:00.000Z')
		const result = await readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date('2026-06-02T00:00:00.000Z'),
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(1)
	})
})
