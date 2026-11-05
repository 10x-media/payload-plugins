// biome-ignore-all lint/plugin/noProcessEnv: load harness env boundary (LOAD_DASHBOARD_SCALE)
import { performance } from 'node:perf_hooks'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult, DimensionKey } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { AGGREGATES_SLUG, HITS_SLUG } from '../../src/native/collections/slugs'
import { orderDigestKey } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { compile, raw } from '../../src/native/store/sql/fragment'
import type { HitRow } from '../../src/native/store/types'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { ingestRoute } from '../../src/next/ingestRoute'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf } from '../int/nativeHelpers'
import { type Beacon, beacons, DEFAULT_SITE, dayHits, type SyntheticSite } from './generator'
import { flagsOf, percentile, printMeasures, record, SCALE } from './measures'

const sized = (n: number): number => Math.max(1, Math.round(n * SCALE))
/** The dashboard's days alone, scaled again: 11 makes its month about 10 million hits. */
const DASHBOARD_SCALE = Number(process.env.LOAD_DASHBOARD_SCALE ?? '1')

const LOAD = {
	ingestBeacons: sized(10_000),
	concurrency: 32,
	appendRows: sized(100_000),
	singleRows: sized(5_000),
	bigDayHits: sized(670_000),
	readDays: 30,
	readDayHits: sized(30_000 * DASHBOARD_SCALE),
	todayHits: sized(20_000),
	repeats: 15,
	warmups: 2,
	/** A read whose first run takes longer is timed this many times instead. */
	slowRepeats: 3,
	slowMs: 2_000,
}

/** Three tenants on their own hosts, so ingest resolves a scope per beacon as a platform does. */
const SCOPES = ['north', 'south', 'west'] as const
const HOSTS = SCOPES.map((scope) => `${scope}.load.test`)
const scopeOfHost = (host: string | null): string | null =>
	SCOPES.find((scope) => host?.split(':')[0] === `${scope}.load.test`) ?? null

const ZONE = 'Europe/Berlin'

/** A host collection, written through Payload while the engine counts. */
const NOTES: CollectionConfig = { slug: 'notes', fields: [{ name: 'title', type: 'text' }] }

const largest = (values: readonly number[]): number =>
	values.reduce((most, value) => Math.max(most, value), 0)

/**
 * The longest the event loop went without running a 10 ms timer, from now until `stop`, the gap
 * still open then included: a loop held for the whole stretch still reads as held.
 */
const stallWatch = () => {
	let last = performance.now()
	let longest = 0
	const timer = setInterval(() => {
		const at = performance.now()
		longest = Math.max(longest, at - last)
		last = at
	}, 10)
	return {
		stop: (): number => {
			clearInterval(timer)
			return Math.max(longest, performance.now() - last)
		},
	}
}

/** Lets every other task in the queue run, as separate requests would. */
const nextTask = (): Promise<void> =>
	new Promise((resolve) => {
		setImmediate(resolve)
	})

/**
 * Times a read after its warm-ups, `settle` run between them and the timed runs so background
 * work they started (a snapshot) finishes first. A read whose first run is slow runs fewer times.
 */
const timeRead = async (
	run: () => Promise<AnalyticsResult | undefined>,
	settle: () => Promise<void>
): Promise<{ times: number[]; last: AnalyticsResult | undefined }> => {
	const started = performance.now()
	let last = await run()
	const slow = performance.now() - started > LOAD.slowMs
	for (let warm = 1; warm < (slow ? 1 : LOAD.warmups); warm++) {
		last = await run()
	}
	await settle()
	const times: number[] = []
	for (let repeat = 0; repeat < (slow ? LOAD.slowRepeats : LOAD.repeats); repeat++) {
		const begun = performance.now()
		last = await run()
		times.push(performance.now() - begun)
	}
	return { times, last }
}

/** Runs `work` over every item with at most `concurrency` in flight, timing each call. */
const pooled = async <T>(
	items: readonly T[],
	concurrency: number,
	work: (item: T) => Promise<void>
): Promise<number[]> => {
	const latencies: number[] = []
	let next = 0
	const worker = async (): Promise<void> => {
		for (let index = next++; index < items.length; index = next++) {
			const item = items[index]
			if (item === undefined) {
				continue
			}
			const started = performance.now()
			await work(item)
			latencies.push(performance.now() - started)
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker))
	return latencies
}

const requestOf = (beacon: Beacon): Request =>
	new Request(`http://${beacon.headers.host}/api${routePaths(DEFAULT_ROUTE_BASE).ingest}`, {
		method: 'POST',
		body: JSON.stringify(beacon.body),
		headers: beacon.headers,
	})

const loadPlugin = (buffered: boolean) => {
	const adapter = native(buffered ? { buffer: true } : {})
	return {
		adapter,
		plugin: analytics({
			adapters: [adapter],
			capture: { gate: 'off' },
			trustedProxyHops: 1,
			reportingTimezone: ZONE,
			scope: { member: () => true, resolve: ({ req }) => scopeOfHost(req.headers.get('host')) },
		}),
	}
}

const site = (scope: string): SyntheticSite => ({
	...DEFAULT_SITE,
	scope,
	hostname: `${scope}.load.test`,
})

/** Appends a generator's chunks, answering the rows written and the wall time it took. */
const appendAll = async (
	payload: Payload,
	chunks: Iterable<HitRow[]>
): Promise<{ rows: number; ms: number }> => {
	const { store } = nativeOf(payload)
	let rows = 0
	const started = performance.now()
	for (const chunk of chunks) {
		rows += (await store.append(chunk)).written
	}
	return { rows, ms: performance.now() - started }
}

describeForDb('native engine under load', {}, (db) => {
	let booted: BootedPayload
	let bufferedBoot: BootedPayload
	const main = loadPlugin(false)
	const buffered = loadPlugin(true)

	beforeAll(async () => {
		booted = await bootPayload({ plugin: main.plugin, db, collections: [NOTES] })
		bufferedBoot = await bootPayload({
			plugin: buffered.plugin,
			db,
			collections: [NOTES],
			attachTo: booted,
		})
		if (db === 'sqlite') {
			const stall = await nativeOf(booted.payload).store.blockingBudgetMs?.()
			record(db, {
				phase: `sqlite: engine statements on ${stall === null || stall === undefined ? 'worker threads' : 'the main thread'}`,
				measure: 'stall bound',
				value: stall ?? 0,
				unit: 'ms',
			})
		}
	})

	afterAll(async () => {
		await bufferedBoot?.stop()
		await booted?.stop()
		printMeasures(db)
	})

	const ingest = async (
		label: string,
		send: (request: Request) => Promise<Response>,
		after?: () => Promise<void>
	): Promise<void> => {
		const list = beacons({ count: LOAD.ingestBeacons, hosts: HOSTS, seed: label.length * 7919 })
		const statuses = new Map<number, number>()
		const started = performance.now()
		const latencies = await pooled(list, LOAD.concurrency, async (beacon) => {
			const response = await send(requestOf(beacon))
			statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1)
		})
		await after?.()
		const seconds = (performance.now() - started) / 1000
		expect(statuses.get(202)).toBe(list.length)
		const target = label.includes('buffered') ? '10,000 hits/s' : '2,000 hits/s'
		record(db, {
			phase: label,
			measure: 'throughput',
			value: list.length / seconds,
			unit: 'hits/s',
			target,
		})
		record(db, {
			phase: label,
			measure: 'latency p50',
			value: percentile(latencies, 50),
			unit: 'ms',
		})
		record(db, {
			phase: label,
			measure: 'latency p95',
			value: percentile(latencies, 95),
			unit: 'ms',
		})
	}

	it(`ingests through the Payload endpoint on ${db}`, async () => {
		await ingest('ingest: Payload endpoint', (request) =>
			handleEndpoints({
				config: booted.payload.config,
				payloadInstanceCacheKey: booted.cacheKey,
				request,
			})
		)
	})

	it(`ingests through ingestRoute on ${db}`, async () => {
		const route = ingestRoute(booted.payload.config, { key: booted.cacheKey })
		await ingest('ingest: ingestRoute', route)
	})

	it(`ingests through ingestRoute with the write buffer on ${db}`, async () => {
		const route = ingestRoute(bufferedBoot.payload.config, { key: bufferedBoot.cacheKey })
		await ingest('ingest: ingestRoute, buffered', route, () =>
			buffered.adapter.flush(bufferedBoot.payload)
		)
	})

	it(`appends hits directly on ${db}`, async () => {
		const today = calendarDayOf(new Date(), ZONE)
		const start = calendarDayStart(addCalendarDays(today, -40), ZONE)
		const batched = await appendAll(
			booted.payload,
			dayHits({ site: site('north'), start, hits: LOAD.appendRows, seed: 11 })
		)
		expect(batched.rows).toBe(LOAD.appendRows)
		record(db, {
			phase: 'append: chunks of 5,000',
			measure: 'throughput',
			value: batched.rows / (batched.ms / 1000),
			unit: 'rows/s',
		})
		const singles = [
			...dayHits({
				site: site('south'),
				start: calendarDayStart(addCalendarDays(today, -41), ZONE),
				hits: LOAD.singleRows,
				seed: 12,
				chunk: 1,
			}),
		]
		const { store } = nativeOf(booted.payload)
		const started = performance.now()
		const latencies = await pooled(singles, LOAD.concurrency, async (rows) => {
			await store.append(rows)
		})
		record(db, {
			phase: 'append: one hit per call',
			measure: 'throughput',
			value: singles.length / ((performance.now() - started) / 1000),
			unit: 'rows/s',
			target: '2,000 hits/s',
		})
		record(db, {
			phase: 'append: one hit per call',
			measure: 'latency p95',
			value: percentile(latencies, 95),
			unit: 'ms',
		})
	})

	it(`aggregates a day of ${LOAD.bigDayHits} hits on ${db}`, async () => {
		const day = addCalendarDays(calendarDayOf(new Date(), ZONE), -3)
		const written = await appendAll(
			booted.payload,
			dayHits({
				site: site('west'),
				start: calendarDayStart(day, ZONE),
				hits: LOAD.bigDayHits,
				seed: 13,
				orders: { server: 0.5, key: orderDigestKey(booted.payload.secret) },
			})
		)
		expect(written.rows).toBe(LOAD.bigDayHits)
		record(db, {
			phase: 'big day: append',
			measure: 'throughput',
			value: written.rows / (written.ms / 1000),
			unit: 'rows/s',
		})
		const { engine, store } = nativeOf(booted.payload)
		const runs: number[] = []
		const stalls: number[] = []
		const singles = dayHits({
			site: site('south'),
			start: calendarDayStart(addCalendarDays(day, -1), ZONE),
			hits: 1_000_000,
			seed: 21,
			chunk: 1,
		})
		for (let run = 0; run < 3; run++) {
			const watch = stallWatch()
			let counting = true
			const started = performance.now()
			const counted = engine.aggregate({ scope: 'west', day, tz: ZONE }).finally(() => {
				counting = false
			})
			if (run < 2) {
				// What a site serves while its biggest day is counted, and counted again over its rows.
				const beacons: number[] = []
				const writes: number[] = []
				const beaconing = (async () => {
					for (let next = singles.next(); counting && !next.done; next = singles.next()) {
						const begun = performance.now()
						await store.append(next.value)
						beacons.push(performance.now() - begun)
						await nextTask()
					}
				})()
				const writing = (async () => {
					while (counting) {
						const begun = performance.now()
						await booted.payload.create({ collection: NOTES.slug, data: { title: 'during' } })
						writes.push(performance.now() - begun)
						await new Promise((resolve) => setTimeout(resolve, 20))
					}
				})()
				await Promise.all([counted, beaconing, writing])
				const again = run === 0 ? '' : ' again'
				for (const [phase, latencies] of [
					[`big day: one hit stored while it is counted${again}`, beacons],
					[`big day: a host write through Payload while it is counted${again}`, writes],
				] as const) {
					record(db, { phase, measure: 'calls', value: latencies.length, unit: '' })
					record(db, { phase, measure: 'p50', value: percentile(latencies, 50), unit: 'ms' })
					record(db, { phase, measure: 'p95', value: percentile(latencies, 95), unit: 'ms' })
					record(db, { phase, measure: 'max', value: largest(latencies), unit: 'ms' })
				}
			}
			const result = await counted
			runs.push(performance.now() - started)
			stalls.push(watch.stop())
			expect(result.outcome).toBe('completed')
		}
		record(db, {
			phase: 'big day: event loop while it is counted',
			measure: 'longest gap between 10 ms ticks, worst of 3',
			value: largest(stalls),
			unit: 'ms',
		})
		const target = db === 'postgres' ? '3-6 s' : '5-15 s'
		record(db, {
			phase: 'big day: aggregate',
			measure: 'first run',
			value: (runs[0] ?? 0) / 1000,
			unit: 's',
			target,
		})
		record(db, {
			phase: 'big day: aggregate',
			measure: 'median of 3',
			value: percentile(runs, 50) / 1000,
			unit: 's',
			target,
		})

		const { state } = nativeOf(booted.payload)
		const week: AnalyticsQuery = {
			scope: 'west',
			timezone: ZONE,
			metrics: ['pageviews', 'visitors', 'sessions', 'bounceRate'],
			dateRange: { start: calendarDayStart(addCalendarDays(day, -3), ZONE), end: new Date() },
		}
		for (const heartbeat of [false, true]) {
			if (heartbeat) {
				await state.beat(MAINTAIN_TASK_SLUG)
			}
			await state.markDirty('west', [day])
			const started = performance.now()
			const result = await main.adapter.query(week, { payload: booted.payload })
			const ms = performance.now() - started
			await engine.idle()
			record(db, {
				phase: `big day uncounted: a week's totals, ${heartbeat ? 'runner heartbeat fresh' : 'no runner heartbeat'}${flagsOf(result)}`,
				measure: 'first read',
				value: ms,
				unit: 'ms',
				target: '< 3,000 ms',
			})
		}

		const evening = new Date(calendarDayStart(day, ZONE).getTime() + 18.5 * 3_600_000)
		const window = { start: new Date(evening.getTime() - 30 * 60_000), end: evening }
		const live: Array<{ name: string; query: AnalyticsQuery }> = [
			{
				name: 'live counter, totals only',
				query: { scope: 'west', metrics: ['visitors'], dateRange: window },
			},
			{
				name: 'live widget, by the minute',
				query: { scope: 'west', metrics: ['visitors'], dateRange: window, granularity: 'minute' },
			},
			{
				name: 'live, top 10 sources',
				query: {
					scope: 'west',
					metrics: ['visitors', 'pageviews'],
					dateRange: window,
					dimensions: ['source'],
					limit: 10,
				},
			},
		]
		for (const read of live) {
			const started = performance.now()
			try {
				const { times, last } = await timeRead(
					async () => main.adapter.realtime?.(read.query, { payload: booted.payload }),
					() => engine.idle()
				)
				record(db, {
					phase: `big day realtime: ${read.name}${flagsOf(last)}`,
					measure: 'p50',
					value: percentile(times, 50),
					unit: 'ms',
				})
			} catch (err) {
				record(db, {
					phase: `big day realtime: ${read.name} (failed: ${err instanceof Error ? err.name : 'error'})`,
					measure: 'time to fail',
					value: performance.now() - started,
					unit: 'ms',
				})
			}
		}
	})

	it(`reads a 30-day dashboard on ${db}`, async () => {
		const now = new Date()
		const today = calendarDayOf(now, ZONE)
		const first = addCalendarDays(today, -LOAD.readDays)
		const shop = site('north')
		let rows = 0
		let appendMs = 0
		for (let offset = 0; offset < LOAD.readDays; offset++) {
			const day = addCalendarDays(first, offset)
			const written = await appendAll(
				booted.payload,
				dayHits({
					site: shop,
					start: calendarDayStart(day, ZONE),
					hits: LOAD.readDayHits,
					seed: 100 + offset,
				})
			)
			rows += written.rows
			appendMs += written.ms
		}
		const todayWritten = await appendAll(
			booted.payload,
			dayHits({
				site: shop,
				start: calendarDayStart(today, ZONE),
				span: now.getTime() - calendarDayStart(today, ZONE).getTime(),
				hits: LOAD.todayHits,
				seed: 99,
				until: now,
			})
		)
		record(db, {
			phase: 'dashboard: append',
			measure: `${rows + todayWritten.rows} rows`,
			value: (rows + todayWritten.rows) / ((appendMs + todayWritten.ms) / 1000),
			unit: 'rows/s',
		})
		const { engine } = nativeOf(booted.payload)
		const perDay: number[] = []
		for (let offset = 0; offset < LOAD.readDays; offset++) {
			const started = performance.now()
			const result = await engine.aggregate({
				scope: 'north',
				day: addCalendarDays(first, offset),
				tz: ZONE,
			})
			perDay.push(performance.now() - started)
			expect(result.outcome).toBe('completed')
		}
		record(db, {
			phase: `dashboard: aggregate ${LOAD.readDayHits}-hit days`,
			measure: 'p50 per day',
			value: percentile(perDay, 50),
			unit: 'ms',
		})
		record(db, {
			phase: `dashboard: aggregate ${LOAD.readDayHits}-hit days`,
			measure: 'p95 per day',
			value: percentile(perDay, 95),
			unit: 'ms',
		})

		const thirty = { start: calendarDayStart(addCalendarDays(today, -29), ZONE), end: now }
		const closed = {
			start: calendarDayStart(first, ZONE),
			end: new Date(calendarDayStart(today, ZONE).getTime() - 1),
		}
		const todayRange = { start: calendarDayStart(today, ZONE), end: now }
		const base = { scope: 'north', timezone: ZONE }
		const top = (dimension: DimensionKey): AnalyticsQuery => ({
			...base,
			metrics: ['pageviews', 'visitors'],
			dimensions: [dimension],
			dateRange: thirty,
			limit: 10,
			order: { metric: 'pageviews', direction: 'desc' },
		})
		const reads: Array<{
			name: string
			query: AnalyticsQuery
			target: string
			realtime?: boolean
		}> = [
			{
				name: 'series, closed days',
				query: {
					...base,
					metrics: ['pageviews', 'visitors'],
					dateRange: closed,
					granularity: 'day',
				},
				target: '< 20 ms',
			},
			{
				name: 'series, 30 days to now',
				query: {
					...base,
					metrics: ['pageviews', 'visitors'],
					dateRange: thirty,
					granularity: 'day',
				},
				target: '',
			},
			{
				name: 'totals, 8 metrics',
				query: {
					...base,
					metrics: [
						'pageviews',
						'visitors',
						'sessions',
						'bounceRate',
						'visitDuration',
						'avgDuration',
						'conversions',
						'revenue',
					],
					dateRange: thirty,
				},
				target: '',
			},
			...(
				[
					'page',
					'referrer',
					'source',
					'channel',
					'country',
					'device',
					'browser',
					'utmCampaign',
				] as const
			).map((dimension) => ({
				name: `top 10 by ${dimension}`,
				query: top(dimension),
				target: '< 120 ms (p95 < 400)',
			})),
			{
				name: 'filtered: country eq, totals',
				query: {
					...base,
					metrics: ['pageviews', 'visitors'],
					dateRange: thirty,
					filters: [{ dimension: 'country', operator: 'eq', value: 'C0' }],
				},
				target: '',
			},
			{
				name: 'filtered: top 10 pages where country eq, a third of visitors',
				query: { ...top('page'), filters: [{ dimension: 'country', operator: 'eq', value: 'C0' }] },
				target: '',
			},
			{
				name: 'filtered: top 10 pages where country eq, 3% of visitors',
				query: { ...top('page'), filters: [{ dimension: 'country', operator: 'eq', value: 'C5' }] },
				target: '',
			},
			{
				name: 'filtered: top 10 sources where page eq (a document panel)',
				query: {
					...top('source'),
					filters: [{ dimension: 'page', operator: 'eq', value: '/p/7' }],
				},
				target: '',
			},
			{
				name: 'filtered: top 10 countries where page eq (a document panel)',
				query: {
					...top('country'),
					metrics: ['visitors'],
					order: { metric: 'visitors', direction: 'desc' },
					filters: [{ dimension: 'page', operator: 'eq', value: '/p/7' }],
				},
				target: '',
			},
			{
				name: 'filtered: top 10 devices where page eq (a document panel)',
				query: {
					...top('device'),
					metrics: ['visitors'],
					order: { metric: 'visitors', direction: 'desc' },
					filters: [{ dimension: 'page', operator: 'eq', value: '/p/7' }],
				},
				target: '',
			},
			{
				name: "a page's totals (a document panel)",
				query: {
					...base,
					metrics: ['pageviews', 'visitors', 'bounceRate', 'avgDuration'],
					dateRange: thirty,
					path: '/p/7',
				},
				target: '',
			},
			{
				name: 'filtered: top 10 pages where page contains',
				query: {
					...top('page'),
					filters: [{ dimension: 'page', operator: 'contains', value: '/p/1' }],
				},
				target: '',
			},
			{
				name: 'today, totals',
				query: {
					...base,
					metrics: ['pageviews', 'visitors', 'sessions', 'bounceRate'],
					dateRange: todayRange,
				},
				target: '< 300 ms',
			},
			{
				name: 'today, top 10 by source',
				query: { ...top('source'), dateRange: todayRange },
				target: '< 300 ms',
			},
			{
				name: 'today, by hour',
				query: {
					...base,
					metrics: ['pageviews', 'visitors'],
					dateRange: todayRange,
					granularity: 'hour',
				},
				target: '< 300 ms',
			},
			{
				name: 'realtime, 30 minutes by the minute',
				query: {
					...base,
					metrics: ['visitors', 'pageviews'],
					dateRange: { start: new Date(now.getTime() - 30 * 60_000), end: now },
					granularity: 'minute',
				},
				target: '',
				realtime: true,
			},
		]
		const watch = stallWatch()
		for (const read of reads) {
			const run = (): Promise<AnalyticsResult | undefined> =>
				read.realtime
					? (main.adapter.realtime?.(read.query, { payload: booted.payload }) ??
						Promise.resolve(undefined))
					: main.adapter.query(read.query, { payload: booted.payload })
			const own = stallWatch()
			const { times, last } = await timeRead(run, () => engine.idle())
			record(db, {
				phase: `read: ${read.name}${flagsOf(last)}`,
				measure: 'longest gap between 10 ms ticks',
				value: own.stop(),
				unit: 'ms',
			})
			record(db, {
				phase: `read: ${read.name}${flagsOf(last)}`,
				measure: 'p50',
				value: percentile(times, 50),
				unit: 'ms',
				target: read.target,
			})
			record(db, {
				phase: `read: ${read.name}${flagsOf(last)}`,
				measure: 'p95',
				value: percentile(times, 95),
				unit: 'ms',
			})
		}
		record(db, {
			phase: 'dashboard: event loop through every read above, background snapshots included',
			measure: 'longest gap between 10 ms ticks',
			value: watch.stop(),
			unit: 'ms',
		})
	})

	it(`measures what an aggregate row and a hit take on disk on ${db}`, async () => {
		const sizes = await storageOf(booted.payload, db)
		if (sizes === null) {
			record(db, {
				phase: 'storage: not measured on this database',
				measure: '',
				value: 0,
				unit: '',
			})
			return
		}
		for (const [name, size] of [
			['aggregates', sizes.aggregates],
			['hits', sizes.hits],
		] as const) {
			record(db, { phase: `storage: ${name}`, measure: 'rows', value: size.rows, unit: '' })
			record(db, {
				phase: `storage: ${name}`,
				measure: 'table bytes per row',
				value: size.table / Math.max(1, size.rows),
				unit: 'B',
			})
			record(db, {
				phase: `storage: ${name}`,
				measure: 'index bytes per row',
				value: size.indexes / Math.max(1, size.rows),
				unit: 'B',
			})
		}
	})
})

interface Size {
	rows: number
	table: number
	indexes: number
}

const numeric = (value: unknown): number => {
	const number = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(number) ? number : 0
}

/** The aggregates' and the hits' rows and bytes, as each database counts them; null where it cannot. */
const storageOf = async (
	payload: Payload,
	db: string
): Promise<{ aggregates: Size; hits: Size } | null> => {
	if (db === 'mongo') {
		const connection: unknown = Reflect.get(payload.db, 'connection')
		const driver: unknown = connection ? Reflect.get(Object(connection), 'db') : undefined
		const command: unknown = driver ? Reflect.get(Object(driver), 'command') : undefined
		if (typeof command !== 'function') {
			return null
		}
		const of = async (slug: string): Promise<Size> => {
			const models: unknown = Reflect.get(payload.db, 'collections')
			const model: unknown = models ? Reflect.get(Object(models), slug) : undefined
			const collection: unknown = model ? Reflect.get(Object(model), 'collection') : undefined
			const name: unknown = collection ? Reflect.get(Object(collection), 'collectionName') : slug
			const stats: unknown = await Reflect.apply(command, driver, [{ collStats: String(name) }])
			return {
				rows: numeric(Reflect.get(Object(stats), 'count')),
				table: numeric(Reflect.get(Object(stats), 'storageSize')),
				indexes: numeric(Reflect.get(Object(stats), 'totalIndexSize')),
			}
		}
		return { aggregates: await of(AGGREGATES_SLUG), hits: await of(HITS_SLUG) }
	}
	const executor = createSqlExecutor(payload)
	const nameOf = (slug: string): string => compile(executor.table(slug), executor.dialect).text
	const of = async (slug: string): Promise<Size> => {
		const table = nameOf(slug)
		const [counted] = await executor.select(raw(`SELECT COUNT(*) AS n FROM ${table}`), 'long')
		if (db === 'postgres') {
			const [sized] = await executor.select(
				raw(`SELECT pg_table_size('${table}') AS t, pg_indexes_size('${table}') AS i`),
				'long'
			)
			return { rows: numeric(counted?.n), table: numeric(sized?.t), indexes: numeric(sized?.i) }
		}
		const bare = table.replaceAll('"', '')
		const rows = await executor
			.select(
				raw(
					`SELECT name = '${bare}' AS own, SUM(pgsize) AS bytes FROM dbstat
						WHERE name = '${bare}' OR name IN (SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${bare}')
						GROUP BY name = '${bare}'`
				),
				'long'
			)
			.catch(() => null)
		if (rows === null) {
			return { rows: numeric(counted?.n), table: 0, indexes: 0 }
		}
		const own = rows.find((row) => numeric(row.own) === 1)
		const other = rows.find((row) => numeric(row.own) === 0)
		return { rows: numeric(counted?.n), table: numeric(own?.bytes), indexes: numeric(other?.bytes) }
	}
	return { aggregates: await of(AGGREGATES_SLUG), hits: await of(HITS_SLUG) }
}
