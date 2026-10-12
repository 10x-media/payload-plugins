import type { Worker } from 'node:worker_threads'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_JOBS } from '../../src/core/jobs'
import { hasMethods, isRecord } from '../../src/core/values'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { createSqlExecutor, type SqlExecutor } from '../../src/native/store/sql/executor'
import { ident, raw, sql } from '../../src/native/store/sql/fragment'
import type { SqliteThread } from '../../src/native/store/sql/sqliteThread'
import { type SpawnSqliteWorker, spawnSqliteWorker } from '../../src/native/store/sql/sqliteWorker'
import { syncTask } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
} from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit } from './nativeHelpers'
import { descriptorsOn, listsDescriptors } from './openDescriptors'
import { readerRequest } from './readerRequest'

/** Enough days that a connection opened per count would show far above any steady handful. */
const DAYS = 40

const SCRATCH = 'analytics_handles_scratch'

/** `count` days, newest first, the newest `offset` days before today. */
const daysBack = (offset: number, count: number): CalendarDay[] => {
	const today = calendarDayOf(new Date(), 'UTC')
	return Array.from({ length: count }, (_, index) => addCalendarDays(today, -(offset + index)))
}

/** Native, plus a memory provider with a pageview a day for sync to write through Payload. */
const bootWith = (db: Parameters<typeof bootPayload>[0]['db'], thread?: SqliteThread) => {
	const mem = memoryAdapter()
	for (const day of daysBack(1, 13)) {
		mem.record({ path: '/synced', timestamp: calendarDayStart(day, 'UTC') })
	}
	return bootPayload({
		db,
		plugin: analytics({
			adapters: [native(thread === undefined ? {} : { sqlite: { thread } }), mem],
			capture: { gate: 'off' },
			// Registered, never scheduled: the spec runs maintenance and sync itself.
			jobs: { tasks: { maintain: { cron: false }, sync: { cron: false } } },
			sync: true,
		}),
	})
}

/** Stores a few pageviews on each day, then counts the days one at a time, as maintenance does. */
const countDays = async (payload: Payload, days: readonly CalendarDay[]): Promise<void> => {
	const { engine, store } = nativeOf(payload)
	for (const day of days) {
		const noon = calendarDayStart(day, 'UTC').getTime() + 12 * 3_600_000
		await store.append(
			Array.from({ length: 3 }, (_, index) =>
				pageviewHit({ ts: new Date(noon + index * 60_000), v: `v${index}` })
			)
		)
		expect(await engine.aggregate({ scope: '', day, tz: 'UTC' })).toEqual({
			outcome: 'completed',
			hits: 3,
		})
	}
}

/** One pass of the sync task, which reads the native engine's days into `analytics-daily`. */
const runSync = async (payload: Payload): Promise<unknown> => {
	const handler = syncTask({
		schedule: DEFAULT_JOBS.sync,
		lookbackDays: 14,
		collectionSlug: 'analytics-daily',
	}).handler
	if (typeof handler !== 'function') {
		throw new Error('the sync task has no handler')
	}
	const result: unknown = await handler({ req: readerRequest(payload) } as unknown as Parameters<
		typeof handler
	>[0])
	return isRecord(result) ? result.output : undefined
}

/** A statement on every thread a SQLite executor runs, and each kind of write transaction. */
const exercise = async (executor: SqlExecutor, round: number): Promise<void> => {
	await executor.select(sql`SELECT 1 AS one`)
	await executor.select(sql`SELECT 1 AS one`, 'long')
	await executor.select(sql`SELECT 1 AS one`, 'count')
	await executor.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${`write ${round}`})`)
	await executor.batch([
		{ statement: sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${`batch ${round}`})`, expect: 1 },
	])
	await executor.transaction((tx) =>
		tx.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${`tx ${round}`})`)
	)
}

describeForDb('database handles while the engine works', {}, (db) => {
	if (db === 'sqlite') {
		for (const thread of ['worker', 'main'] as const) {
			describe(`SQLite, statements on the ${thread} thread`, () => {
				let booted: BootedPayload
				let file: string
				const open = () => ({ db: descriptorsOn(file), wal: descriptorsOn(`${file}-wal`) })

				beforeAll(async () => {
					booted = await bootWith(db, thread)
					file = booted.connectionString.replace(/^file:/, '')
					await countDays(booted.payload, daysBack(DAYS + 10, 1))
				}, 240_000)

				afterAll(async () => {
					await booted?.stop()
				})

				it.runIf(listsDescriptors())(
					`holds the file open no more often after ${DAYS} days are counted`,
					async () => {
						const before = open()
						await countDays(booted.payload, daysBack(5, DAYS))
						const after = open()
						expect(after.db).toBeLessThanOrEqual(before.db)
						expect(after.wal).toBeLessThanOrEqual(before.wal)
					}
				)

				it.runIf(listsDescriptors())(
					'holds the file open no more often after a sync pass',
					async () => {
						const before = open()
						const output = await runSync(booted.payload)
						expect(output).toMatchObject({ failed: 0 })
						expect(isRecord(output) ? Number(output.synced) : 0).toBeGreaterThan(0)
						expect(open().db).toBeLessThanOrEqual(before.db)
					}
				)

				it.runIf(listsDescriptors())(
					'leaves no descriptor behind for a statement that failed',
					async () => {
						const executor = createSqlExecutor(booted.payload, { thread, lanes: 3 })
						const missing = ident('analytics_handles_missing')
						await executor.select(sql`SELECT 1 AS one`)
						await executor.execute(sql`CREATE TABLE IF NOT EXISTS ${ident(SCRATCH)} (v TEXT)`)
						try {
							const before = open()
							for (let round = 0; round < 10; round++) {
								await expect(executor.select(sql`SELECT * FROM ${missing}`)).rejects.toThrow()
								await expect(
									executor.execute(sql`INSERT INTO ${missing} (v) VALUES (${round})`)
								).rejects.toThrow()
							}
							// A failure that is not about a lock keeps its connection, which still commits.
							await executor.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${'after'})`)
							const [kept] = await executor.select(
								sql`SELECT count(*) AS n FROM ${ident(SCRATCH)} WHERE v = ${'after'}`
							)
							expect(Number(kept?.n)).toBe(1)
							const after = open()
							expect(after.db).toBeLessThanOrEqual(before.db)
							expect(after.wal).toBeLessThanOrEqual(before.wal)
						} finally {
							await executor.execute(sql`DROP TABLE IF EXISTS ${ident(SCRATCH)}`)
							await executor.close()
						}
					}
				)

				it.runIf(listsDescriptors())(
					'opens what its threads need once, however often they stop and start again',
					async () => {
						const spawned: Worker[] = []
						const spawn: SpawnSqliteWorker = (data) => {
							const worker = spawnSqliteWorker(data)
							spawned.push(worker)
							return worker
						}
						// Three lanes named outright are a set of threads apart from the engine's, which
						// would keep its own running through every close here.
						const executor = createSqlExecutor(booted.payload, { thread, lanes: 3, spawn })
						await executor.execute(
							sql`CREATE TABLE ${ident(SCRATCH)} (${raw('id INTEGER PRIMARY KEY, v TEXT')})`
						)
						await exercise(executor, 0)
						await executor.close()
						const started = open()
						for (let round = 1; round <= 4; round++) {
							await exercise(executor, round)
							await executor.close()
						}
						expect(open().db).toBeLessThanOrEqual(started.db)
						expect(spawned).toHaveLength(thread === 'worker' ? 15 : 0)
						const [counted] = await executor.select(
							sql`SELECT count(*) AS n FROM ${ident(SCRATCH)}`
						)
						expect(Number(counted?.n)).toBe(15)
						await executor.close()
					}
				)
			})
		}
		return
	}

	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootWith(db)
		await countDays(booted.payload, daysBack(DAYS + 10, 1))
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	if (db === 'postgres') {
		/** The adapter's node-postgres pool: every client it opened, and those not checked out. */
		const poolOf = (payload: Payload): { totalCount: number; idleCount: number } => {
			const pool: unknown = Reflect.get(payload.db, 'pool')
			if (!hasMethods(pool, ['connect', 'query']) || !isRecord(pool)) {
				throw new Error('the Postgres adapter holds no pool')
			}
			return { totalCount: Number(pool.totalCount), idleCount: Number(pool.idleCount) }
		}

		it(`checks every connection back in, and opens no more, after ${DAYS} days are counted`, async () => {
			const before = poolOf(booted.payload)
			await countDays(booted.payload, daysBack(5, DAYS))
			const after = poolOf(booted.payload)
			expect(after.idleCount).toBe(after.totalCount)
			expect(after.totalCount).toBeLessThanOrEqual(Math.max(before.totalCount, 2))
		})
		return
	}

	/** What the server reports open: connections from every client, and cursors not yet exhausted. */
	const serverOpen = async (
		payload: Payload
	): Promise<{ connections: number; cursors: number }> => {
		const connection: unknown = Reflect.get(payload.db, 'connection')
		const database: unknown = isRecord(connection) ? connection.db : undefined
		const admin: unknown = hasMethods(database, ['admin'])
			? Reflect.apply(Reflect.get(Object(database), 'admin'), database, [])
			: undefined
		if (!hasMethods(admin, ['serverStatus'])) {
			throw new Error('the Mongo adapter holds no database to ask for its status')
		}
		const status: unknown = await Reflect.apply(
			Reflect.get(Object(admin), 'serverStatus'),
			admin,
			[]
		)
		const connections = isRecord(status) && isRecord(status.connections) ? status.connections : {}
		const metrics = isRecord(status) && isRecord(status.metrics) ? status.metrics : {}
		const cursor = isRecord(metrics.cursor) ? metrics.cursor : {}
		const opened = isRecord(cursor.open) ? cursor.open : {}
		return { connections: Number(connections.current), cursors: Number(opened.total) }
	}

	it(`opens no more connections, and leaves no cursor open, after ${DAYS} days are counted`, async () => {
		const before = await serverOpen(booted.payload)
		await countDays(booted.payload, daysBack(5, DAYS))
		const after = await serverOpen(booted.payload)
		expect(after.connections).toBeLessThanOrEqual(before.connections + 2)
		expect(after.cursors).toBe(0)
	})
})
