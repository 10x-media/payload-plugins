import { performance } from 'node:perf_hooks'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf } from '../int/nativeHelpers'
import { DEFAULT_SITE, dayHits } from './generator'
import { flagsOf, percentile, printMeasures, record, SCALE } from './measures'

/** A platform of many small tenants: what the per-scope work of reads and upkeep is measured at. */
const TENANTS = {
	count: Math.max(2, Math.round(1_000 * SCALE)),
	/** Closed days with hits, before today. */
	days: 2,
	hitsPerDay: 30,
	/** Maintenance runs after the first, which has every day to count. */
	idleRuns: 3,
	budgetMs: 240_000,
	repeats: 4,
}

const ZONE = 'Europe/Berlin'

const scopes = Array.from({ length: TENANTS.count }, (_, i) => `t${String(i).padStart(5, '0')}`)

describeForDb(`native engine over ${TENANTS.count} tenants`, {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				reportingTimezone: ZONE,
				scope: { member: () => true, resolve: () => null },
				access: { crossScope: () => true },
			}),
		})
	}, 600_000)

	afterAll(async () => {
		await booted?.stop()
		printMeasures(db, `${db}: ${TENANTS.count} tenants`)
	}, 600_000)

	it(`keeps upkeep and every-site reads bounded over ${TENANTS.count} tenants on ${db}`, async () => {
		const { store, engine } = nativeOf(booted.payload)
		const today = calendarDayOf(new Date(), ZONE)
		const started = performance.now()
		let rows = 0
		for (const [index, scope] of scopes.entries()) {
			const site = {
				...DEFAULT_SITE,
				pages: 50,
				referrers: 20,
				campaigns: 5,
				items: 10,
				scope,
				hostname: `${scope}.test`,
			}
			for (let back = 1; back <= TENANTS.days; back++) {
				for (const chunk of dayHits({
					site,
					start: calendarDayStart(addCalendarDays(today, -back), ZONE),
					hits: TENANTS.hitsPerDay,
					seed: index * 31 + back,
				})) {
					rows += (await store.append(chunk)).written
				}
			}
		}
		record(db, {
			phase: 'append',
			measure: `${rows} hits`,
			value: performance.now() - started,
			unit: 'ms',
		})

		const budgetTarget = `< ${Math.round(TENANTS.budgetMs / 10)} ms (10% of the budget)`
		const maintain = async (label: string, target?: string) => {
			const begun = performance.now()
			const report = await engine.maintain({ budgetMs: TENANTS.budgetMs, heartbeat: true })
			const ms = performance.now() - begun
			expect(report.ran).toBe(true)
			record(db, {
				phase: `maintenance: ${label} (${report.scopesPassed} passed, ${report.scopesSkipped} skipped, ${report.aggregated} counted, ${report.discovered} found, ${report.empty} marked empty)`,
				measure: report.finished ? 'finished in' : 'stopped at the budget after',
				value: ms,
				unit: 'ms',
				...(target === undefined ? {} : { target }),
			})
			return { report, ms }
		}
		const first = await maintain('first run, every day to count')
		expect(first.report.finished).toBe(true)
		const idle: number[] = []
		for (let run = 1; run <= TENANTS.idleRuns; run++) {
			idle.push((await maintain(`idle run ${run}`, budgetTarget)).ms)
		}
		expect(Math.max(...idle)).toBeLessThan(TENANTS.budgetMs / 10)
		// Every tenant had a visit since, the same day: its orders and today looked at, nothing counted.
		for (const nth of ['first', 'second', 'third']) {
			const visited = new Date()
			await store.append(
				scopes.flatMap((scope, index) =>
					[
						...dayHits({
							site: { ...DEFAULT_SITE, scope, hostname: `${scope}.test` },
							start: new Date(visited.getTime() - 60_000),
							hits: 1,
							span: 30_000,
							seed: 7_919 * nth.length + index,
						}),
					].flat()
				)
			)
			const active = await maintain(`every tenant visited since, ${nth} time`, budgetTarget)
			expect(active.report.scopesPassed).toBe(TENANTS.count)
		}

		const now = new Date()
		const month = { start: calendarDayStart(addCalendarDays(today, -29), ZONE), end: now }
		const reads: Array<{ name: string; query: AnalyticsQuery; live?: boolean; target?: string }> = [
			{
				name: 'every site, totals, 30 days',
				query: { metrics: ['pageviews', 'visitors'], dateRange: month, timezone: ZONE },
				target: db === 'postgres' ? '< 500 ms' : '< 15,000 ms (the read timeout) with margin',
			},
			{
				name: 'every site, top 10 sources, 30 days',
				query: {
					metrics: ['pageviews', 'visitors'],
					dateRange: month,
					timezone: ZONE,
					dimensions: ['source'],
					limit: 10,
				},
			},
			{
				name: 'one site, totals, 30 days',
				query: {
					metrics: ['pageviews', 'visitors'],
					dateRange: month,
					timezone: ZONE,
					scope: scopes[7],
				},
			},
			{
				name: 'every site, live visitors, 30 minutes',
				query: {
					metrics: ['visitors', 'pageviews'],
					dateRange: { start: new Date(now.getTime() - 30 * 60_000), end: now },
				},
				live: true,
			},
		]
		for (const read of reads) {
			const run = (): Promise<AnalyticsResult> =>
				read.live ? engine.realtime(read.query) : engine.read(read.query)
			let last = await run()
			await engine.idle()
			const times: number[] = []
			for (let repeat = 0; repeat < TENANTS.repeats; repeat++) {
				const begun = performance.now()
				last = await run()
				times.push(performance.now() - begun)
			}
			await engine.idle()
			record(db, {
				phase: `read: ${read.name}${flagsOf(last)}`,
				measure: 'p50',
				value: percentile(times, 50),
				unit: 'ms',
				...(read.target === undefined ? {} : { target: read.target }),
			})
			record(db, {
				phase: `read: ${read.name}${flagsOf(last)}`,
				measure: 'max',
				value: Math.max(...times),
				unit: 'ms',
			})
		}
	}, 3_600_000)
})
