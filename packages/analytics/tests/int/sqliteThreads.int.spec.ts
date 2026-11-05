import type { Worker } from 'node:worker_threads'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { hasMethods } from '../../src/core/values'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { numberOf } from '../../src/native/store/columnValues'
import { isLibsqlClient, type LibsqlClient } from '../../src/native/store/sql/drivers'
import { createSqlExecutor, type SqlExecutor } from '../../src/native/store/sql/executor'
import { ident, raw, sql } from '../../src/native/store/sql/fragment'
import {
	type SpawnSqliteWorker,
	SqliteWorkersClosed,
	spawnSqliteWorker,
} from '../../src/native/store/sql/sqliteWorker'
import { LONG_COUNT_SQL, stallBound, ticking } from '../../src/testing/timerTicks'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DEFAULT_SITE, dayHits } from '../load/generator'
import { nativeOf } from './nativeHelpers'

const SCRATCH = 'analytics_thread_scratch'

/** A host collection, written through Payload while the engine works. */
const NOTES: CollectionConfig = { slug: 'notes', fields: [{ name: 'title', type: 'text' }] }

/** The host's own libsql client, the one Payload's adapter writes through. */
const hostClientOf = (payload: Payload): LibsqlClient => {
	const client: unknown = Reflect.get(payload.db, 'client')
	if (!isLibsqlClient(client)) {
		throw new Error('the SQLite adapter holds no libsql client')
	}
	return client
}

describeForDb('SQLite engine statements on worker threads', {}, (db) => {
	if (db !== 'sqlite') {
		it.skip('runs on SQLite only', () => undefined)
		return
	}

	let booted: BootedPayload
	let executor: SqlExecutor

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ sqlite: { thread: 'worker' } })],
				capture: { gate: 'off' },
				jobs: false,
			}),
			collections: [NOTES],
		})
		executor = createSqlExecutor(booted.payload, { thread: 'worker' })
		await executor.execute(
			sql`CREATE TABLE ${ident(SCRATCH)} (${raw('id INTEGER PRIMARY KEY, v TEXT')})`
		)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	/** What a test left open, undone even when it failed part way, so the next test starts clean. */
	const undo: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const step of undo.splice(0).reverse()) {
			await step().catch(() => undefined)
		}
		// The attached boot of the last test pushes its own schema, which drops this table.
		const [scratch] = await executor.select(
			sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${SCRATCH}`
		)
		if ((numberOf(scratch?.n) ?? 0) > 0) {
			await executor.execute(sql`DELETE FROM ${ident(SCRATCH)}`)
		}
	})

	/** A write transaction on the host's own client, rolled back after the test unless it ended. */
	const hostWrite = async () => {
		const tx = await hostClientOf(booted.payload).transaction('write')
		let open = true
		undo.push(async () => {
			if (open) {
				open = false
				await tx.rollback()
				tx.close()
			}
		})
		return {
			insert: (v: string) =>
				tx.execute({ sql: `INSERT INTO "${SCRATCH}" (v) VALUES ('${v}')`, args: [] }),
			commit: async () => {
				open = false
				await tx.commit()
				tx.close()
			},
		}
	}

	const scratchIds = async (): Promise<string[]> =>
		(await executor.select(sql`SELECT v FROM ${ident(SCRATCH)} ORDER BY id`)).map((row) =>
			String(row.v)
		)

	it('picks worker threads on the harness file, which is WAL with a 5 second busy timeout', async () => {
		expect(await createSqlExecutor(booted.payload, { thread: 'auto' }).blocking()).toBe(false)
		expect(await createSqlExecutor(booted.payload, { thread: 'main' }).blocking()).toBe(true)
		expect(await executor.blocking()).toBe(false)
	})

	it('lets a timer fire long before a transaction of 20,000 statements ends', async () => {
		const run = await ticking(() =>
			executor.transaction(async (tx) => {
				for (let i = 0; i < 20_000; i++) {
					await tx.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${`row ${i}`})`)
				}
			})
		)
		expect(run.error).toBeUndefined()
		expect(run.firstAt).toBeLessThan(run.ms / 2)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
		const [counted] = await executor.select(sql`SELECT count(*) AS n FROM ${ident(SCRATCH)}`)
		expect(numberOf(counted?.n)).toBe(20_000)
	})

	it('keeps timers ticking through one long statement', async () => {
		const run = await ticking(() => executor.select(raw(LONG_COUNT_SQL), 'count'))
		expect(run.value).toEqual([{ n: 4_000_000 }])
		expect(run.ms).toBeGreaterThan(150)
		expect(run.ticks).toBeGreaterThan(run.ms / 25)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
	})

	it('waits off the main thread for a host transaction held across awaits, and the write lands', async () => {
		const tx = await hostWrite()
		await tx.insert('host')
		const committed = new Promise<void>((resolve, reject) => {
			setTimeout(() => {
				tx.commit().then(resolve, reject)
			}, 400)
		})
		const run = await ticking(() =>
			executor.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${'engine'})`)
		)
		await committed
		expect(run.error).toBeUndefined()
		expect(run.ms).toBeGreaterThan(300)
		expect(run.ticks).toBeGreaterThan(30)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
		expect(await scratchIds()).toEqual(['host', 'engine'])
	})

	it('fails with SQLITE_BUSY off the main thread once its wait runs out, and loses no write after', async () => {
		const impatient = createSqlExecutor(booted.payload, { thread: 'worker', busyTimeoutMs: 300 })
		undo.push(() => impatient.close())
		const tx = await hostWrite()
		await tx.insert('host')
		const run = await ticking(() =>
			impatient.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${'too soon'})`)
		)
		await tx.commit()
		expect(run.error).toMatchObject({ code: 'SQLITE_BUSY' })
		expect(run.ticks).toBeGreaterThan(20)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
		await impatient.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${'after'})`)
		await impatient.transaction((session) =>
			session.execute(sql`INSERT INTO ${ident(SCRATCH)} (v) VALUES (${'after tx'})`)
		)
		expect(await scratchIds()).toEqual(['host', 'after', 'after tx'])
	})

	it('lets the host write through Payload while a day is counted on a worker thread', async () => {
		const { engine, store } = nativeOf(booted.payload)
		const day = addCalendarDays(calendarDayOf(new Date(), 'UTC'), -2)
		for (const chunk of dayHits({
			site: { ...DEFAULT_SITE, scope: '', hostname: 'threads.test' },
			start: calendarDayStart(day, 'UTC'),
			hits: 60_000,
			seed: 7,
		})) {
			await store.append(chunk)
		}
		const writes: number[] = []
		let counting = true
		const counted = engine.aggregate({ scope: '', day, tz: 'UTC' }).finally(() => {
			counting = false
		})
		const run = await ticking(async () => {
			while (counting) {
				const started = performance.now()
				await booted.payload.create({ collection: 'notes', data: { title: `w${writes.length}` } })
				writes.push(performance.now() - started)
				await new Promise((resolve) => setTimeout(resolve, 5))
			}
			return counted
		})
		expect(run.error).toBeUndefined()
		expect(run.value).toEqual({ outcome: 'completed', hits: 60_000 })
		expect(run.ms).toBeGreaterThan(500)
		expect(writes.length).toBeGreaterThan(10)
		expect((await booted.payload.count({ collection: 'notes' })).totalDocs).toBe(writes.length)
		expect(run.worstGapMs).toBeLessThan(stallBound(run.ms))
	})

	it('stops its threads when Payload is destroyed', async () => {
		const second = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' }, jobs: false }),
			collections: [NOTES],
			attachTo: booted,
		})
		const spawned: Worker[] = []
		const spawn: SpawnSqliteWorker = (data) => {
			const worker = spawnSqliteWorker(data)
			spawned.push(worker)
			return worker
		}
		const own = createSqlExecutor(second.payload, { thread: 'worker', spawn })
		await own.select(sql`SELECT 1 AS one`)
		await own.select(sql`SELECT 1 AS one`, 'long')
		expect(spawned).toHaveLength(2)
		const exits = spawned.map((worker) => new Promise((resolve) => worker.once('exit', resolve)))
		await second.stop()
		await Promise.all(exits)
		expect(hasMethods(second.payload, ['destroy'])).toBe(true)
		// A statement after the destroy starts no thread nobody would ever stop, even once let go of.
		await expect(own.select(sql`SELECT 1 AS one`, 'long')).rejects.toBeInstanceOf(
			SqliteWorkersClosed
		)
		await own.close()
		await expect(own.select(sql`SELECT 1 AS one`, 'long')).rejects.toThrow()
		expect(spawned).toHaveLength(2)
	})
})
