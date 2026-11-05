import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { ulid } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { countHits, nativeOf } from './nativeHelpers'

/** A landing pageview on `/` at `ts`, by a visitor of its own. */
const pageviewAt = (ts: Date, v: string): HitRow => ({
	id: ulid(ts),
	scope: '',
	ts,
	type: 'pageview',
	hostname: 'h',
	path: '/',
	v,
	landing: true,
	server: false,
})

describeForDb('native retention', {}, (db) => {
	const adapter = native({ retention: { rawDays: 30 } })
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		// Held still, so the raw floor the engine reports is the one this spec works out.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		const now = clock.now().getTime()
		await nativeOf(booted.payload).store.append([
			pageviewAt(new Date(now - 40 * DAY_MS), 'old-visitor'),
			pageviewAt(new Date(now - 60_000), 'new-visitor'),
		])
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	const lastSixtyDays = () => {
		const now = clock.now().getTime()
		return { start: new Date(now - 60 * DAY_MS), end: new Date(now + 60_000) }
	}

	// A read only raw hits answer (a `contains` filter) reads them back `rawDays` days at most.
	it('reads raw hits back as far as retention.rawDays, and says where a longer read starts', async () => {
		const filtered = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: lastSixtyDays(),
				filters: [{ dimension: 'page', operator: 'contains', value: '/' }],
				timezone: 'UTC',
			},
			{ payload: booted.payload }
		)
		expect(filtered.totals).toEqual({ pageviews: 1 })
		const floorDay = addCalendarDays(calendarDayOf(clock.now(), 'UTC'), -29)
		expect(filtered.meta).toMatchObject({
			clamped: true,
			dataFrom: calendarDayStart(floorDay, 'UTC').toISOString(),
		})
		expect(adapter.capabilities.filterLookbackDays).toBe(30)
	})

	it('answers an unfiltered read over every day, its older days from their daily totals', async () => {
		const plain = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dateRange: lastSixtyDays() },
			{ payload: booted.payload }
		)
		expect(plain.totals).toEqual({ pageviews: 2, visitors: 2 })
		expect(plain.meta.clamped).toBeUndefined()
	})

	it('deletes no raw hit while reading, the ones past rawDays included', async () => {
		expect(await countHits(booted.payload)).toBe(2)
	})

	it('prunes the raw hits past rawDays once maintenance has counted their day, keeping its totals', async () => {
		const report = await nativeOf(booted.payload).engine.maintain({ budgetMs: 120_000 })
		expect(report.prunedHits).toBe(1)
		expect(await countHits(booted.payload)).toBe(1)
		const plain = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dateRange: lastSixtyDays() },
			{ payload: booted.payload }
		)
		expect(plain.totals).toEqual({ pageviews: 2, visitors: 2 })
	})

	// One task is what turns Payload's jobs on, the payload-jobs collection and the stats global
	// with it.
	it('registers its maintenance task, which turns Payload’s jobs on', () => {
		expect(booted.payload.config.jobs?.tasks?.map((task) => task.slug)).toEqual([
			MAINTAIN_TASK_SLUG,
		])
		expect(booted.payload.config.jobs?.enabled).toBe(true)
		expect(booted.payload.config.collections.map((c) => c.slug)).toContain('payload-jobs')
	})
})
