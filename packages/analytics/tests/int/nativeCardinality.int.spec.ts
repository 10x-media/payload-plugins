import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import { analytics } from '../../src/index'
import { HITS_SLUG } from '../../src/native/collections/slugs'
import { createEngine } from '../../src/native/engine/engine'
import { MAX_COUNT_ATTEMPTS } from '../../src/native/engine/maintenance'
import { native } from '../../src/native/nativeAdapter'
import { dayWindow, kindOf } from '../../src/native/store/aggregate'
import { type CardinalityCaps, DEFAULT_CAPS, resolveCaps } from '../../src/native/store/caps'
import { numberOf } from '../../src/native/store/columnValues'
import { hitsModelOf } from '../../src/native/store/eventStore'
import { TWIN_WINDOW_MS } from '../../src/native/store/hits'
import { dayAggregationPipeline } from '../../src/native/store/mongo/aggregatePipelines'
import { compileDayAggregation } from '../../src/native/store/sql/aggregateSql'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { raw } from '../../src/native/store/sql/fragment'
import { dayKey } from '../../src/native/store/state'
import type { HitRow } from '../../src/native/store/types'
import { calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit } from './nativeHelpers'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const DAY = 20261005
const SCOPE = 'wide'
const HOST = 'wide.example'

/** Distinct paths on one day: what an attacker sending random paths, or a huge site, leaves. */
const PATHS: Record<string, number> = { mongo: 20_000, postgres: 200_000, sqlite: 200_000 }

const PAGE_CAP = DEFAULT_CAPS.page ?? 0

/** Every kind uncapped: the day's read with no tail folded. */
const UNCAPPED = resolveCaps(
	Object.fromEntries(Object.keys(DEFAULT_CAPS).map((key) => [key, null]))
)

const pageKind = kindOf('page', '')?.index

/** A full collection, so what a measure holds is told from garbage left before it. */
const collect: () => void = (() => {
	setFlagsFromString('--expose_gc')
	const gc: unknown = runInNewContext('gc')
	return () => {
		if (typeof gc === 'function') {
			gc()
		}
	}
})()

const megabytes = (bytes: number): number => Math.round(bytes / 1_048_576)

/** The most the heap grew while `work` ran, sampled every few milliseconds from a clean heap. */
const peakHeapGrowth = async <T>(work: () => Promise<T>): Promise<{ value: T; mb: number }> => {
	collect()
	const base = process.memoryUsage().heapUsed
	let peak = base
	const sample = setInterval(() => {
		peak = Math.max(peak, process.memoryUsage().heapUsed)
	}, 5)
	try {
		const value = await work()
		peak = Math.max(peak, process.memoryUsage().heapUsed)
		return { value, mb: megabytes(peak - base) }
	} finally {
		clearInterval(sample)
	}
}

/** What `work`'s answer holds on the heap once everything else it made is collected. */
const retained = async <T>(work: () => Promise<T>): Promise<{ value: T; mb: number }> => {
	collect()
	const base = process.memoryUsage().heapUsed
	const value = await work()
	collect()
	return { value, mb: megabytes(process.memoryUsage().heapUsed - base) }
}

describeForDb('native day counts of unbounded values', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const paths = PATHS[db] ?? 20_000

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ retention: { rawDays: 5 } })],
				capture: { gate: 'off' },
				jobs: false,
				scope: { resolve: () => null, member: () => true },
				access: { crossScope: () => true },
			}),
		})
		const start = calendarDayStart(DAY, 'UTC').getTime()
		const hits: HitRow[] = Array.from({ length: paths }, (_, index) =>
			pageviewHit({
				scope: SCOPE,
				hostname: HOST,
				ts: new Date(start + Math.floor((index * 86_000_000) / paths)),
				v: `v${String(Math.floor(index / 4)).padStart(15, '0')}`,
				path: `/p/${index}`,
			})
		)
		const { store } = nativeOf(booted.payload)
		for (let at = 0; at < hits.length; at += 20_000) {
			await store.append(hits.slice(at, at + 20_000))
		}
		if (db === 'postgres') {
			// Planned without statistics, Postgres takes the table for nearly empty, as autovacuum
			// would not leave one this size.
			await createSqlExecutor(booted.payload).execute(raw('ANALYZE "analytics_hits"'))
		}
	}, 600_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	}, 120_000)

	it(`answers a day's count with at most the caps' rows, the tail folded, on ${db}`, async () => {
		const window = dayWindow(SCOPE, DAY, 'UTC')
		let pages: number[] = []
		if (db === 'mongo') {
			const { collection } = hitsModelOf(booted.payload)
			const select = async (caps: CardinalityCaps): Promise<unknown[]> => {
				const pipeline = dayAggregationPipeline(window, {
					itemPages: true,
					fold: 'sets',
					twins: { from: HITS_SLUG, windowMs: TWIN_WINDOW_MS },
					caps,
				})
				const cursor: unknown = collection.aggregate(pipeline, { allowDiskUse: true })
				const toArray: unknown = isRecord(cursor) ? cursor.toArray : undefined
				const docs: unknown =
					typeof toArray === 'function' ? await Reflect.apply(toArray, cursor, []) : []
				return Array.isArray(docs) ? docs : []
			}
			const capped = await retained(() => select(DEFAULT_CAPS))
			const whole = await retained(() => select(UNCAPPED))
			console.log(
				`[cardinality] ${db}: a day's read of ${paths} paths answered ${capped.value.length} rows (heap +${capped.mb} MB) capped in the database, ${whole.value.length} (heap +${whole.mb} MB) uncapped`
			)
			expect(whole.value.length).toBeGreaterThan(paths)
			pages = capped.value.flatMap((doc) => {
				const key = isRecord(doc) && isRecord(doc._id) ? doc._id : {}
				return key.k === pageKind ? [numberOf(key.o) ?? 0] : []
			})
		} else {
			const executor = createSqlExecutor(booted.payload)
			const target = { dialect: executor.dialect, hits: executor.table(HITS_SLUG) }
			// As the store reads a day: on Postgres in a transaction of its own, JIT off.
			const select = (caps: CardinalityCaps) => {
				const statement = compileDayAggregation(window, target, { itemPages: true, caps })
				return db === 'postgres'
					? executor.transaction((tx) => tx.select(statement), { analytical: true })
					: executor.select(statement, 'count')
			}
			const capped = await retained(() => select(DEFAULT_CAPS))
			const whole = await retained(() => select(UNCAPPED))
			console.log(
				`[cardinality] ${db}: a day's read of ${paths} paths answered ${capped.value.length} rows (heap +${capped.mb} MB) capped in the database, ${whole.value.length} (heap +${whole.mb} MB) uncapped`
			)
			expect(whole.value.length).toBeGreaterThan(paths)
			expect(capped.mb).toBeLessThan(Math.max(8, whole.mb / 4))
			pages = capped.value.flatMap((row) =>
				numberOf(row.k) === pageKind ? [numberOf(row.o) ?? 0] : []
			)
		}
		expect(pages).toHaveLength(Math.min(paths, PAGE_CAP) + (paths > PAGE_CAP ? 1 : 0))
		expect(pages.filter((folded) => folded === 1)).toHaveLength(paths > PAGE_CAP ? 1 : 0)
	}, 600_000)

	it(`counts the day within a bounded heap, every pageview kept in the totals, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const counted = await peakHeapGrowth(() =>
			engine.aggregate({ scope: SCOPE, day: DAY, tz: 'UTC' })
		)
		console.log(`[cardinality] ${db}: ${paths} distinct paths counted, heap grew ${counted.mb} MB`)
		expect(counted.value).toMatchObject({ outcome: 'completed', hits: paths })
		expect(counted.mb).toBeLessThan(256)
		const days = [[DAY, DAY]] as const
		const [site] = await store.readAggregates({ scope: SCOPE, days, dim: '', groupBy: 'total' })
		const [pages] = await store.readAggregates({
			scope: SCOPE,
			days,
			dim: 'page',
			groupBy: 'total',
		})
		expect(site?.parts.pageviews).toBe(paths)
		expect(pages?.parts.pageviews).toBe(paths)
		const top = await store.readAggregates({
			scope: SCOPE,
			days,
			dim: 'page',
			groupBy: 'value',
			order: { part: 'pageviews', dir: 'desc' },
		})
		expect(top).toHaveLength(Math.min(paths, PAGE_CAP))
	}, 600_000)

	it(`reads a page folded into (other) from its raw hits while they are kept, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const stall = (await store.blockingBudgetMs?.()) ?? null
		const read = await engine.read({
			metrics: ['pageviews'],
			scope: SCOPE,
			timezone: 'UTC',
			path: `/p/${paths - 1}`,
			dateRange: {
				start: calendarDayStart(DAY, 'UTC'),
				end: new Date(calendarDayStart(DAY + 1, 'UTC').getTime() - 1),
			},
		})
		expect(read.meta.capped).toBeUndefined()
		if (stall === null) {
			expect(read.totals).toEqual({ pageviews: 1 })
		} else {
			// On SQLite's main thread a raw read of the whole day would hold every request up.
			expect(read.meta.partial).toEqual({ missingDays: 1 })
		}
	}, 120_000)

	it(`gives up on a day whose count keeps failing, prunes past it and says so, on ${db}`, async () => {
		const { store, state } = nativeOf(booted.payload)
		const day = 20261006
		await store.append([
			pageviewHit({
				scope: 'failing',
				ts: new Date(calendarDayStart(day, 'UTC').getTime() + 3_600_000),
				v: 'failing-visitor0',
			}),
		])
		const engine = createEngine({
			payload: booted.payload,
			store: {
				...store,
				aggregateDay: async (window, run) => {
					if (window.scope === 'failing') {
						throw new Error('the database ran out of memory')
					}
					return store.aggregateDay(window, run)
				},
			},
			state,
			options: { scoped: true, rawDays: 5, warn: () => undefined },
		})
		try {
			const attempts = []
			for (let run = 0; run <= MAX_COUNT_ATTEMPTS; run++) {
				clock.advance(16 * 60_000)
				attempts.push(await engine.maintain({ budgetMs: 120_000 }))
			}
			expect(attempts.map((report) => [report.failed, report.markedFailed])).toEqual([
				...Array.from({ length: MAX_COUNT_ATTEMPTS }, () => [1, 0]),
				[0, 1],
			])
			const [marker] = await state.markers('failing', day, day)
			expect(marker).toMatchObject({ status: 'failed', leaseOwner: null })
			expect(await state.claim(dayKey('failing', day), 'check', 60_000)).toBe(true)
			await state.release(dayKey('failing', day), 'check')
			const read = await engine.read({
				metrics: ['pageviews'],
				scope: 'failing',
				timezone: 'UTC',
				dateRange: {
					start: calendarDayStart(day, 'UTC'),
					end: new Date(calendarDayStart(day + 1, 'UTC').getTime() - 1),
				},
			})
			expect(read.meta.failed).toEqual({ days: 1 })
			clock.advance(6 * 86_400_000)
			await engine.maintain({ budgetMs: 120_000 })
			expect(await store.oldestHit('failing')).toBeNull()
		} finally {
			await engine.close()
		}
	}, 600_000)
})
