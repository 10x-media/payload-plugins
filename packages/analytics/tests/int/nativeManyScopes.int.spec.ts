import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { HITS_SLUG, STATE_SLUG } from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { TWIN_WINDOW_MS } from '../../src/native/store/hits'
import { rawReadPipeline } from '../../src/native/store/mongo/pipelines'
import { planRawRead, rawFilterMap } from '../../src/native/store/rawRead'
import { compileRawRead } from '../../src/native/store/sql/compile'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { compile } from '../../src/native/store/sql/fragment'
import { sqlStateStore } from '../../src/native/store/sql/sqlState'
import { sqlEventStore } from '../../src/native/store/sql/sqlStore'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { explainFind, explainPipeline, explainSql, indexBoundsOf, recording } from './explain'
import { nativeOf, pageviewHit } from './nativeHelpers'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000
const ZONE = 'Europe/Berlin'
const SCOPES = ['north', 'south', 'west']
const TODAY = calendarDayOf(NOW, ZONE)

/** Closed days only, so every scope's part of the read comes from its daily totals. */
const WEEK = {
	start: calendarDayStart(addCalendarDays(TODAY, -6), ZONE),
	end: new Date(calendarDayStart(TODAY, ZONE).getTime() - 1),
}

const LIVE = { start: new Date(NOW.getTime() - 30 * MINUTE), end: NOW }

const visitor = (label: string): string => label.padEnd(16, '0')

describeForDb('native reads and upkeep over many scopes', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				reportingTimezone: ZONE,
				scope: { resolve: () => null, member: () => true },
				access: { crossScope: () => true },
			}),
		})
		await nativeOf(booted.payload).store.append(
			SCOPES.flatMap((scope, index) => [
				...Array.from({ length: index + 2 }, (_, n) =>
					pageviewHit({
						scope,
						ts: new Date(NOW.getTime() - 2 * DAY_MS + n * MINUTE),
						v: visitor(`${scope}-old-${n}`),
					})
				),
				...Array.from({ length: index + 1 }, (_, n) =>
					pageviewHit({
						scope,
						ts: new Date(NOW.getTime() - (5 + n) * MINUTE),
						v: visitor(`${scope}-live-${n}`),
					})
				),
			])
		)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`reads every site's live visitors by scope, the per-scope reads adding up, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const realtime = vi.spyOn(store, 'realtime')
		try {
			const query: AnalyticsQuery = { metrics: ['visitors', 'pageviews'], dateRange: LIVE }
			const all = await engine.realtime(query)
			expect(realtime).toHaveBeenCalledTimes(1)
			expect(realtime.mock.calls[0]?.[0]).toMatchObject({ scopes: SCOPES })
			expect(realtime.mock.calls[0]?.[0]).not.toHaveProperty('scope')
			const each = await Promise.all(SCOPES.map((scope) => engine.realtime({ ...query, scope })))
			const sum = (metric: 'visitors' | 'pageviews') =>
				each.reduce((total, result) => total + (result.totals?.[metric] ?? 0), 0)
			expect(all.totals).toEqual({ visitors: sum('visitors'), pageviews: sum('pageviews') })
			expect(all.totals).toEqual({ visitors: 6, pageviews: 6 })
		} finally {
			realtime.mockRestore()
		}
	})

	it(`reads the live totals of every site off the (scope, ts) index on ${db}`, async () => {
		const read = {
			scopes: SCOPES,
			start: LIVE.start,
			end: LIVE.end,
			filters: [],
			sessions: false,
			timeoutMs: 8_000,
		}
		if (db === 'mongo') {
			const plan = planRawRead(read, { id: 'mongo', filters: rawFilterMap(['eq']) })
			const pipeline = rawReadPipeline(plan, { from: HITS_SLUG, windowMs: TWIN_WINDOW_MS }, null)
			const bounds = indexBoundsOf(await explainPipeline(booted.payload, HITS_SLUG, pipeline))
			const scoped = bounds.filter((each) => each.index === 'scope_1_ts_1')
			expect(scoped.length).toBeGreaterThan(0)
			for (const each of scoped) {
				expect(JSON.stringify(each.bounds)).not.toContain('MinKey')
			}
			return
		}
		const executor = createSqlExecutor(booted.payload)
		const plan = planRawRead(read, { id: db, filters: rawFilterMap(['eq']) })
		const statement = compileRawRead(plan, {
			dialect: executor.dialect,
			hits: executor.table(HITS_SLUG),
		})
		const explained = await explainSql(executor, statement)
		expect(explained).toContain('scope_ts_idx')
		if (db === 'sqlite') {
			expect(explained).toMatch(/scope_ts_idx \(scope=\? AND ts>\? AND ts<\?\)/)
		} else {
			expect(explained).toMatch(/"Index Cond":"[^"]*scope[^"]*ts/)
		}
	})

	it(`finds a scope's day markers off the (kind, scope, day) index on ${db}`, async () => {
		const from = addCalendarDays(TODAY, -40)
		if (db === 'mongo') {
			const plans = [
				await explainFind(booted.payload, STATE_SLUG, {
					filter: { kind: 'day', scope: 'north', day: { $gte: from, $lte: TODAY } },
					sort: { day: 1 },
				}),
				await explainFind(booted.payload, STATE_SLUG, {
					filter: {
						kind: 'day',
						scope: { $in: SCOPES },
						day: { $gte: from, $lte: TODAY },
						gen: { $type: 'string' },
					},
				}),
			]
			for (const plan of plans) {
				const indexes = indexBoundsOf(plan).map((each) => each.index)
				expect(indexes).toContain('kind_1_scope_1_day_1')
				expect(indexes).not.toContain('kind_1_status_1_day_1')
			}
			return
		}
		const { executor, selects } = recording(createSqlExecutor(booted.payload))
		const state = sqlStateStore(executor)
		await state.markers('north', from, TODAY)
		await state.markersIn(SCOPES, from, TODAY)
		await state.lastZone('north')
		await state.scopes()
		await sqlEventStore(executor, { state }).readAggregates({
			scopes: SCOPES,
			days: [[from, TODAY]],
			dim: '',
			groupBy: 'total',
		})
		expect(selects).toHaveLength(5)
		for (const statement of selects.splice(0)) {
			const explained = await explainSql(executor, statement).catch((err: unknown) => {
				throw new Error(`${String(err)}: ${compile(statement, executor.dialect).text}`)
			})
			expect(explained).toContain('kind_scope_day_idx')
			expect(explained).not.toContain('kind_status_day_idx')
			if (db === 'sqlite') {
				expect(explained).not.toMatch(/SCAN analytics_state\b/)
			}
		}
	})

	it(`reads every site's day markers and prune cuts in one statement each, the scopes adding up, on ${db}`, async () => {
		const { engine, state } = nativeOf(booted.payload)
		await engine.maintain({ budgetMs: 60_000 })
		const markers = vi.spyOn(state, 'markers')
		const markersIn = vi.spyOn(state, 'markersIn')
		const prunedBefore = vi.spyOn(state, 'prunedBefore')
		const prunedBeforeIn = vi.spyOn(state, 'prunedBeforeIn')
		const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: WEEK, timezone: ZONE }
		try {
			const all = await engine.read(query)
			expect(markers).not.toHaveBeenCalled()
			expect(prunedBefore).not.toHaveBeenCalled()
			expect(markersIn).toHaveBeenCalledTimes(1)
			expect(prunedBeforeIn).toHaveBeenCalledTimes(1)
			expect(all.meta.partial).toBeUndefined()
			markers.mockClear()
			const each = await Promise.all(SCOPES.map((scope) => engine.read({ ...query, scope })))
			expect(markers).toHaveBeenCalledTimes(SCOPES.length)
			expect(all.totals?.pageviews).toBe(
				each.reduce((total, result) => total + (result.totals?.pageviews ?? 0), 0)
			)
			expect(all.totals).toEqual({ pageviews: 9 })
		} finally {
			vi.restoreAllMocks()
		}
	})

	it(`counts every site's hits today in one statement, never one per scope, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const countHits = vi.spyOn(store, 'countHits')
		const countEach = vi.spyOn(store, 'countEach')
		try {
			const result = await engine.read({
				metrics: ['pageviews'],
				dateRange: { start: WEEK.start, end: NOW },
				timezone: ZONE,
			})
			expect(countHits).not.toHaveBeenCalled()
			expect(countEach).toHaveBeenCalledTimes(1)
			expect(result.totals).toEqual({ pageviews: 15 })
		} finally {
			vi.restoreAllMocks()
		}
		const window = { start: new Date(NOW.getTime() - 3 * DAY_MS), end: NOW }
		const counted = await store.countEach([...SCOPES, 'none'], window, 3)
		for (const scope of SCOPES) {
			expect(counted.get(scope)).toBe(await store.countHits({ scope, ...window }, 3))
		}
		expect(counted.get('none')).toBe(0)
		expect(Math.max(...counted.values())).toBe(4)
	})

	it(`passes over every scope with nothing new since its last full pass, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		clock.advance(20 * MINUTE)
		await engine.maintain({ budgetMs: 60_000 })
		expect(await engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			finished: true,
			scopesPassed: 0,
			scopesSkipped: SCOPES.length,
		})
		await store.append([pageviewHit({ scope: 'south', ts: clock.now(), v: visitor('south-new') })])
		expect(await engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			scopesPassed: 1,
			scopesSkipped: SCOPES.length - 1,
		})
	})
})
