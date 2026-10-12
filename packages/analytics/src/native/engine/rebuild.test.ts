import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { CHANNEL_TAXONOMY_VERSION } from '../ingest/source'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import type { HitRow } from '../store/types'
import { createEngine, type EngineOptions } from './engine'
import { checkRebuildInput, classifyTuple } from './rebuild'

const NOON = new Date('2026-10-07T12:00:00.000Z')
const TODAY = 20261007

let serial = 0

/** A landing an older taxonomy classified as `channel`, an hour into a UTC day. */
const landing = (scope: string, day: CalendarDay, more: Partial<HitRow>): HitRow => {
	serial += 1
	return {
		id: `R${String(serial).padStart(8, '0')}`,
		scope,
		ts: new Date(calendarDayStart(day, 'UTC').getTime() + 3_600_000),
		type: 'pageview',
		hostname: 'a.example',
		path: '/',
		v: `r${serial}`.padEnd(16, 'x'),
		landing: true,
		server: false,
		channelVersion: CHANNEL_TAXONOMY_VERSION - 1,
		...more,
	}
}

const rig = async (options: EngineOptions, hits: readonly HitRow[]) => {
	const now = () => NOON
	const state = memoryStateStore({ now })
	const store = memoryEventStore({ state, now })
	await store.append(hits)
	const engine = createEngine({
		payload: { logger: { warn: () => undefined } } as unknown as Payload,
		store,
		state,
		options: { now, warn: () => undefined, ...options },
	})
	return { store, state, engine }
}

const window = (from: CalendarDay, to: CalendarDay) => ({
	from: calendarDayStart(from, 'UTC'),
	to: calendarDayStart(to, 'UTC'),
})

/** Pageviews by channel over the UTC days from `from` up to, not including, `to`. */
const channels = async (
	engine: Awaited<ReturnType<typeof rig>>['engine'],
	from: CalendarDay,
	to: CalendarDay
) =>
	(
		await engine.read({
			metrics: ['pageviews'],
			dimensions: ['channel'],
			dateRange: {
				start: calendarDayStart(from, 'UTC'),
				end: new Date(calendarDayStart(to, 'UTC').getTime() - 1),
			},
		})
	).rows.map((row) => [row.dimensions?.channel, row.metrics.pageviews])

describe('classifyTuple', () => {
	it('classifies a stored tuple as ingest classifies a hit, a null read as absent', () => {
		expect(
			classifyTuple({ ref: 'google.com', utmSource: null, utmMedium: null, clickId: null })
		).toBe('organic-search')
		expect(classifyTuple({ ref: null, utmSource: null, utmMedium: null, clickId: 'gclid' })).toBe(
			'paid-search'
		)
		expect(classifyTuple({ ref: null, utmSource: 'news', utmMedium: 'email', clickId: null })).toBe(
			'email'
		)
		expect(classifyTuple({ ref: null, utmSource: null, utmMedium: null, clickId: null })).toBe(
			'direct'
		)
	})
})

describe('checkRebuildInput', () => {
	it('takes two instants in order, and refuses anything else', () => {
		const ok = { from: new Date(0), to: NOON }
		expect(checkRebuildInput(ok)).toBe(ok)
		expect(() => checkRebuildInput({ from: NOON, to: NOON })).toThrow(/from before to/)
		expect(() => checkRebuildInput({ from: new Date(Number.NaN), to: NOON })).toThrow(
			/two instants/
		)
	})
})

describe('a rebuild', () => {
	it('classifies hits of an older taxonomy again, and marks only their counted days dirty', async () => {
		const hits = [
			landing('', 20261003, { ref: 'google.com', source: 'google.com', channel: 'referral' }),
			landing('', 20261004, { ref: 'news.example', source: 'news.example', channel: 'referral' }),
			landing('', 20261005, {
				ref: 'google.com',
				source: 'google.com',
				channel: 'organic-search',
				channelVersion: CHANNEL_TAXONOMY_VERSION,
			}),
		]
		const ready = await rig({}, hits)
		for (const day of [20261003, 20261004, 20261005]) {
			await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		expect(await channels(ready.engine, 20261003, 20261006)).toEqual([
			['referral', 2],
			['organic-search', 1],
		])
		const report = await ready.engine.rebuild({ ...window(20261003, 20261006), reclassify: true })
		expect(report).toEqual({ reclassified: 2, dirty: 3 })
		const markers = await ready.state.markers('', 20261003, 20261005)
		expect(markers.map((marker) => marker.status)).toEqual(['dirty', 'dirty', 'dirty'])
		expect(await channels(ready.engine, 20261003, 20261006)).toEqual([
			['organic-search', 2],
			['referral', 1],
		])
		const again = await ready.engine.rebuild({ ...window(20261003, 20261006), reclassify: true })
		expect(again.reclassified).toBe(0)
	})

	it('leaves a day whose count is fixed, and a day not closed yet, as they are', async () => {
		const ready = await rig({ rawDays: 5 }, [
			landing('', 20261001, { ref: 'google.com', channel: 'referral' }),
			landing('', 20261004, { ref: 'google.com', channel: 'referral' }),
			landing('', TODAY, { ref: 'google.com', channel: 'referral' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261001, tz: 'UTC' })
		// Maintenance cut the raw hits at 20261003: 20261001's count is all that is left of it.
		await ready.state.recordPruned('', calendarDayStart(20261003, 'UTC'))
		const report = await ready.engine.rebuild(window(20260930, 20261008))
		expect(report).toEqual({ reclassified: 0, dirty: 1 })
		expect((await ready.state.markers('', 20261001, 20261001))[0]?.status).toBe('final')
		expect((await ready.state.markers('', 20261004, 20261004))[0]?.status).toBe('dirty')
		expect(await ready.state.markers('', TODAY, TODAY)).toEqual([])
	})

	it('counts a day past rawDays again while none of its raw hits has been pruned', async () => {
		const ready = await rig({ rawDays: 5 }, [
			landing('', 20261001, { ref: 'google.com', channel: 'referral' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261001, tz: 'UTC' })
		expect(await ready.engine.rebuild(window(20260930, 20261002))).toEqual({
			reclassified: 0,
			dirty: 1,
		})
	})

	it('covers one scope when named, every scope otherwise, and refuses a scope with no zone', async () => {
		const hits = [
			landing('a', 20261004, { ref: 'google.com', channel: 'referral' }),
			landing('b', 20261004, { ref: 'google.com', channel: 'referral' }),
		]
		const ready = await rig({ scoped: true }, hits)
		expect(
			await ready.engine.rebuild({ ...window(20261004, 20261005), scope: 'a', reclassify: true })
		).toEqual({
			reclassified: 1,
			dirty: 1,
		})
		expect(await ready.engine.rebuild({ ...window(20261004, 20261005), reclassify: true })).toEqual(
			{
				reclassified: 1,
				dirty: 2,
			}
		)
		const zoneless = await rig(
			{
				scoped: true,
				timezone: () => {
					throw new Error('tenant lookup down')
				},
			},
			hits
		)
		await expect(zoneless.engine.rebuild(window(20261004, 20261005))).rejects.toThrow(
			/reporting timezone of scope "a" could not be resolved/
		)
	})
})
