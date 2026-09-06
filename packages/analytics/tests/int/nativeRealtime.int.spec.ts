import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'

describeForDb('native realtime', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const adapter = native()

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('counts active visitors and pageviews in the window, excluding older events', async () => {
		const now = new Date('2026-06-24T12:00:00.000Z')
		const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
		const rows = [
			{ visitorHash: 'a', minAgo: 1 },
			{ visitorHash: 'a', minAgo: 2 },
			{ visitorHash: 'b', minAgo: 3 },
			{ visitorHash: 'c', minAgo: 40 },
		]
		for (const r of rows) {
			await booted.payload.create({
				collection: EVENTS_SLUG as never,
				data: {
					timestamp: at(r.minAgo),
					type: 'pageview',
					path: '/p',
					hostname: 'h',
					visitorHash: r.visitorHash,
					sessionId: r.visitorHash,
				} as never,
			})
		}
		const result = await adapter.realtime?.(
			{
				metrics: ['visitors', 'pageviews'],
				dateRange: { start: new Date(now.getTime() - 10 * 60_000), end: now },
			},
			{}
		)
		expect(result?.totals).toEqual({ visitors: 2, pageviews: 3 })
		expect(result?.meta.provider).toBe('native')
	})

	it('narrows to a single host when q.hostname is set on a realtime read', async () => {
		const now = new Date('2026-06-24T13:00:00.000Z')
		const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
		const rows = [
			{ visitorHash: 'd', hostname: 'h', minAgo: 1 },
			{ visitorHash: 'e', hostname: 'h2', minAgo: 1 },
		]
		for (const r of rows) {
			await booted.payload.create({
				collection: EVENTS_SLUG as never,
				data: {
					timestamp: at(r.minAgo),
					type: 'pageview',
					path: '/p',
					hostname: r.hostname,
					visitorHash: r.visitorHash,
					sessionId: r.visitorHash,
				} as never,
			})
		}
		const dateRange = { start: new Date(now.getTime() - 10 * 60_000), end: now }
		const combined = await adapter.realtime?.({ metrics: ['pageviews'], dateRange }, {})
		expect(combined?.totals).toEqual({ pageviews: 2 })

		const scopedToH = await adapter.realtime?.(
			{ metrics: ['pageviews'], dateRange, hostname: 'h' },
			{}
		)
		expect(scopedToH?.totals).toEqual({ pageviews: 1 })
	})
})
