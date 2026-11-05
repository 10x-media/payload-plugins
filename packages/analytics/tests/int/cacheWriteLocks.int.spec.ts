import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { sqliteTestAdapter } from '@10x-media/payload-test-harness/db/sqlite'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { createSqlExecutor, type SqlExecutor } from '../../src/native/store/sql/executor'
import { getRuntime } from '../../src/plugin/runtime'
import { collectionCacheStore } from '../../src/surfacing/collectionCacheStore'

const MINUTE = 60_000

/** A promise and the function that settles it, to hold a lock for as long as a test needs. */
const held = () => {
	let release = (): void => undefined
	const done = new Promise<void>((resolve) => {
		release = resolve
	})
	return { done, release }
}

/** How a promise ended and how long it took: a SQLite lock wait stops the clock it is timed on. */
const timed = async <T>(work: Promise<T>) => {
	const started = performance.now()
	const outcome = await work.then(
		(value) => ({ value, error: undefined }),
		(error: unknown) => ({ value: undefined, error })
	)
	return { ...outcome, ms: performance.now() - started }
}

/**
 * Read cache writes through Payload's own SQLite connection; on the main thread a write waiting on
 * a lock this process holds blocks the event loop for the whole busy timeout, then fails.
 */
describeForDb('analytics read cache writes beside locks this process holds', {}, (db) => {
	if (db !== 'sqlite') {
		it.skip('runs on SQLite only', () => undefined)
		return
	}

	let booted: BootedPayload
	let transactional: BootedPayload
	let clock: TestClock

	const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

	beforeAll(async () => {
		clock = installTestClock(new Date('2026-03-10T12:00:00.000Z'))
		booted = await bootPayload({ db, plugin: plugin() })
		// Payload's SQLite adapter opens no transaction unless transactionOptions is set.
		transactional = await bootPayload({
			db,
			attachTo: booted,
			plugin: plugin(),
			configOverrides: {
				db: sqliteTestAdapter(booted.connectionString, { transactionOptions: {} }),
			},
		})
	}, 240_000)

	afterAll(async () => {
		clock.reset()
		await transactional?.stop()
		await booted?.stop()
	})

	/** One entry already past its stale window, for a sweep to delete. */
	const expiredEntry = async (payload: Payload, key: string) => {
		const store = collectionCacheStore(payload, { slug: 'analytics-cache' })
		await store.set(
			key,
			{ rows: [], meta: { provider: 'native', fetchedAt: '' } },
			{
				ttlSeconds: 1,
				staleSeconds: 1,
			}
		)
		clock.advance(MINUTE)
		return store
	}

	it(`waits for the engine's own write transaction rather than for the busy timeout on ${db}`, async () => {
		const { payload } = booted
		const store = await expiredEntry(payload, 'swept-after-engine')
		const executor: SqlExecutor = createSqlExecutor(payload, { thread: 'main' })
		const lock = held()
		const begun = held()
		const engineWrite = executor.transaction(async () => {
			begun.release()
			await lock.done
		})
		await begun.done
		const sweep = timed(store.sweep(clock.now(), 100))
		await new Promise((resolve) => setTimeout(resolve, 50))
		lock.release()
		await engineWrite
		const swept = await sweep
		expect(swept.error).toBeUndefined()
		expect(swept.value).toBe(1)
		expect(swept.ms).toBeLessThan(2_000)
		await executor.close()
	})

	it(`leaves the sweep for later while a transaction the host began is open on ${db}`, async () => {
		const { payload } = transactional
		const store = await expiredEntry(payload, 'swept-after-host')
		const transactionID = await payload.db.beginTransaction()
		expect(transactionID).toBeTruthy()
		// The host's transaction writes, so it holds SQLite's one write lock until it ends.
		await payload.db.create({
			collection: 'users',
			data: { email: 'locked@t.dev', password: 'test-password' },
			req: { transactionID: transactionID ?? undefined },
		})
		const during = await timed(store.sweep(clock.now(), 100))
		expect(during.error).toBeUndefined()
		expect(during.value).toBe(0)
		expect(during.ms).toBeLessThan(1_000)
		// The runtime's own sweep would first claim its lease, an engine write that waits as well.
		const sweeper = getRuntime(payload)?.cache?.sweeper
		const leased = await timed(sweeper ? sweeper.sweep() : Promise.reject(new Error('no sweeper')))
		expect(leased.error).toBeUndefined()
		expect(leased.value).toEqual({ ran: false, swept: 0 })
		expect(leased.ms).toBeLessThan(1_000)
		await payload.db.rollbackTransaction(transactionID ?? '')
		const after = await timed(store.sweep(clock.now(), 100))
		expect(after.error).toBeUndefined()
		expect(after.value).toBe(1)
	})
})
