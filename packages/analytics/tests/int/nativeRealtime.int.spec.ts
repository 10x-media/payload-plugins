import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { ulid } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { nativeOf } from './nativeHelpers'

/** A pageview `minAgo` minutes before `now`, by visitor `v`, on `hostname`. */
const pageview = (now: Date, args: { v: string; minAgo: number; hostname?: string }): HitRow => {
	const ts = new Date(now.getTime() - args.minAgo * 60_000)
	return {
		id: ulid(ts),
		scope: '',
		ts,
		type: 'pageview',
		hostname: args.hostname ?? 'h',
		path: '/p',
		v: args.v,
		landing: true,
		server: false,
	}
}

describeForDb('native realtime', {}, (db) => {
	let booted: BootedPayload
	const adapter = native()

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('counts active visitors and pageviews in the window, excluding older events', async () => {
		const now = new Date('2026-06-24T12:00:00.000Z')
		await nativeOf(booted.payload).store.append([
			pageview(now, { v: 'a', minAgo: 1 }),
			pageview(now, { v: 'a', minAgo: 2 }),
			pageview(now, { v: 'b', minAgo: 3 }),
			pageview(now, { v: 'c', minAgo: 40 }),
		])
		const result = await adapter.realtime?.(
			{
				metrics: ['visitors', 'pageviews'],
				dateRange: { start: new Date(now.getTime() - 10 * 60_000), end: now },
			},
			{ payload: booted.payload }
		)
		expect(result?.totals).toEqual({ visitors: 2, pageviews: 3 })
		expect(result?.meta.provider).toBe('native')
	})

	it('narrows to a single host when q.hostname is set on a realtime read', async () => {
		const now = new Date('2026-06-24T13:00:00.000Z')
		await nativeOf(booted.payload).store.append([
			pageview(now, { v: 'd', minAgo: 1 }),
			pageview(now, { v: 'e', minAgo: 1, hostname: 'h2' }),
		])
		const dateRange = { start: new Date(now.getTime() - 10 * 60_000), end: now }
		const combined = await adapter.realtime?.(
			{ metrics: ['pageviews'], dateRange },
			{ payload: booted.payload }
		)
		expect(combined?.totals).toEqual({ pageviews: 2 })

		const scopedToH = await adapter.realtime?.(
			{ metrics: ['pageviews'], dateRange, hostname: 'h' },
			{ payload: booted.payload }
		)
		expect(scopedToH?.totals).toEqual({ pageviews: 1 })
	})
})
