import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { STATE_SLUG } from '../../src/native/collections/slugs'
import { createDailySalts } from '../../src/native/engine/salt'
import { native } from '../../src/native/nativeAdapter'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { sql } from '../../src/native/store/sql/fragment'
import {
	dayFinalAfter,
	dayKey,
	heartbeatStale,
	leaseKey,
	saltKey,
} from '../../src/native/store/state'
import { createStateStore, stateModelOf } from '../../src/native/store/stateStore'
import type { DayMarker, StateStore } from '../../src/native/store/types'

const MINUTE = 60_000
const START = Date.parse('2026-10-06T12:00:00.000Z')

/** One clock both instances read, moved by hand so no test waits on real time. */
const clock = { at: START }
const now = (): Date => new Date(clock.at)
const advance = (ms: number): void => {
	clock.at += ms
}

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

describeForDb('engine state store', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload
	let a: StateStore
	let b: StateStore

	beforeAll(async () => {
		first = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: first })
		a = createStateStore(first.payload, { now })
		b = createStateStore(second.payload, { now })
	}, 240_000)

	afterAll(async () => {
		await second?.stop()
		await first?.stop()
	})

	beforeEach(async () => {
		clock.at = START
		if (db === 'mongo') {
			await stateModelOf(first.payload).deleteMany({})
			return
		}
		const executor = createSqlExecutor(first.payload)
		await executor.execute(sql`DELETE FROM ${executor.table(STATE_SLUG)}`)
	})

	/** How many state rows hold a key, read through Payload's own adapter. */
	const rowsFor = async (key: string): Promise<number> =>
		(
			await first.payload.db.count({
				collection: STATE_SLUG,
				where: { id: { equals: key } },
				req: {},
			})
		).totalDocs

	const markerFor = async (store: StateStore, scope: string, day: number) =>
		(await store.markers(scope, day, day))[0]

	it('converges every concurrent creator of a day’s salt on the one stored, across instances', async () => {
		const day = 20261005
		const salts = await Promise.all(
			Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? a : b).salt(day))
		)
		expect(new Set(salts).size).toBe(1)
		expect(salts[0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(await rowsFor(saltKey(day))).toBe(1)
		expect(await b.salt(day)).toBe(salts[0])
		expect(await a.salt(20261006)).not.toBe(salts[0])
	})

	it('serves two instances’ salt caches from one stored salt per day', async () => {
		const at = new Date('2026-10-05T20:00:00.000Z')
		const [fromA, fromB] = await Promise.all([
			createDailySalts({ state: a, now }).forHit({ scope: 'in', at, zone: () => 'Asia/Kolkata' }),
			createDailySalts({ state: b, now }).forHit({ scope: 'in', at, zone: () => 'Asia/Kolkata' }),
		])
		expect(fromA).toEqual(fromB)
		expect(fromA.day).toBe(20261006)
		// The first fetch of a day creates the next day's salt ahead of midnight.
		await expect.poll(() => rowsFor(saltKey(20261007))).toBe(1)
	})

	it('deletes the expired salts once the daily salts fetch a later day', async () => {
		for (const day of [20261002, 20261003, 20261004]) {
			await a.salt(day)
		}
		await createDailySalts({ state: b, now }).forDay(20261006)
		await expect.poll(() => rowsFor(saltKey(20261003))).toBe(0)
		expect(await rowsFor(saltKey(20261002))).toBe(0)
		expect(await rowsFor(saltKey(20261004))).toBe(1)
	})

	it('lets one owner hold a lease until it expires, then the next', async () => {
		const key = leaseKey('contention')
		expect(await a.claim(key, 'owner-a', 10 * MINUTE)).toBe(true)
		expect(await b.claim(key, 'owner-b', 10 * MINUTE)).toBe(false)
		advance(5 * MINUTE)
		expect(await a.claim(key, 'owner-a', 10 * MINUTE)).toBe(true)
		advance(9 * MINUTE)
		expect(await b.claim(key, 'owner-b', 10 * MINUTE)).toBe(false)
		advance(2 * MINUTE)
		expect(await b.claim(key, 'owner-b', 10 * MINUTE)).toBe(true)
		expect(await a.release(key, 'owner-a')).toBe(false)
		expect(await b.release(key, 'owner-b')).toBe(true)
		expect(await a.claim(key, 'owner-a', 10 * MINUTE)).toBe(true)
		expect(await rowsFor(key)).toBe(1)
	})

	it('hands a contested fresh lease to exactly one of many concurrent claimants', async () => {
		const key = leaseKey('race')
		const won = await Promise.all(
			Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? a : b).claim(key, `owner-${i}`, MINUTE))
		)
		expect(won.filter(Boolean)).toHaveLength(1)
		expect(await rowsFor(key)).toBe(1)
	})

	it('fences a day’s completion on the lease: a stale owner is refused', async () => {
		const day = 20261005
		const key = dayKey('fenced', day)
		expect(await a.claim(key, 'run-a', 10 * MINUTE)).toBe(false)
		await a.ensureMarkers([{ scope: 'fenced', day, tz: 'UTC' }])
		expect(await a.claim(key, 'run-a', 10 * MINUTE)).toBe(true)
		expect(await b.claim(key, 'run-b', 10 * MINUTE)).toBe(false)
		advance(11 * MINUTE)
		expect(await b.claim(key, 'run-b', 10 * MINUTE)).toBe(true)
		const done = (gen: string): DayMarker => ({
			scope: 'fenced',
			day,
			tz: 'UTC',
			start: null,
			status: 'provisional',
			version: 1,
			gen,
			hits: 42,
			leaseOwner: null,
			leaseUntil: null,
			finalAfter: dayFinalAfter(day, 'UTC'),
			aggregatedAt: now(),
		})
		expect(await a.complete(done('run-a'), 'run-a')).toBe(false)
		expect(await b.complete(done('run-b'), 'run-b')).toBe(true)
		expect(await b.complete(done('run-b'), 'run-b')).toBe(false)
		expect(await markerFor(a, 'fenced', day)).toEqual(done('run-b'))
	})

	it('frees a day marked dirty mid-run at once, which that run can neither renew nor complete', async () => {
		const day = 20261005
		const key = dayKey('dirty', day)
		await a.ensureMarkers([{ scope: 'dirty', day, tz: 'UTC' }])
		expect(await a.claim(key, 'run-a', 10 * MINUTE)).toBe(true)
		const [held] = await a.markers('dirty', day, day)
		expect(await a.attempt({ ...(held as DayMarker), failures: 2 }, 'run-a')).toBe(true)
		expect(await markerFor(b, 'dirty', day)).toMatchObject({ failures: 2, leaseOwner: 'run-a' })
		await b.markDirty('dirty', [day])
		const marker = await markerFor(b, 'dirty', day)
		expect(marker).toMatchObject({ status: 'dirty', leaseOwner: null, leaseUntil: null })
		expect(marker).not.toHaveProperty('failures')
		expect(
			await a.complete({ ...(marker as DayMarker), status: 'final', gen: 'run-a' }, 'run-a')
		).toBe(false)
		expect(await a.renew(key, 'run-a', 10 * MINUTE)).toBe(false)
		expect((await b.pending(now(), 10)).map((due) => due.scope)).toEqual(['dirty'])
		expect(await b.claim(key, 'run-b', 10 * MINUTE)).toBe(true)
		expect(await b.renew(key, 'run-b', 10 * MINUTE)).toBe(true)
		advance(15 * MINUTE)
		// Expired but never taken: still its owner's to renew, never another's by renewal.
		expect(await b.renew(key, 'run-b', 10 * MINUTE)).toBe(true)
		expect(await a.renew(key, 'run-a', 10 * MINUTE)).toBe(false)
		expect(await markerFor(a, 'dirty', day)).toMatchObject({ status: 'dirty', leaseOwner: 'run-b' })
	})

	it('records an attempt and a give-up while the owner holds the day, and forgets them on completion', async () => {
		const day = 20261005
		const key = dayKey('attempts', day)
		await a.ensureMarkers([{ scope: 'attempts', day, tz: 'UTC' }])
		expect(await a.claim(key, 'run-a', 10 * MINUTE)).toBe(true)
		const held = (await markerFor(a, 'attempts', day)) as DayMarker
		expect(await b.attempt({ ...held, failures: 1 }, 'run-b')).toBe(false)
		expect(await a.attempt({ ...held, failures: 3, status: 'failed' }, 'run-a')).toBe(true)
		expect(await markerFor(b, 'attempts', day)).toMatchObject({
			status: 'failed',
			failures: 3,
			leaseOwner: 'run-a',
		})
		expect(await b.pending(new Date(START + 2 * 86_400_000), 10)).toEqual([])
		expect(
			await a.complete({ ...held, status: 'final', gen: 'G', aggregatedAt: now() }, 'run-a')
		).toBe(true)
		const done = await markerFor(b, 'attempts', day)
		expect(done).toMatchObject({ status: 'final', leaseOwner: null })
		expect(done).not.toHaveProperty('failures')
	})

	it('pages due days by day and then scope, from after the last one seen', async () => {
		const scopes = ['b', 'a', 'Z', 'aa']
		await a.ensureMarkers(scopes.map((scope) => ({ scope, day: 20261002, tz: 'UTC' })))
		await a.ensureMarkers([{ scope: 'a', day: 20261003, tz: 'UTC' }])
		const at = new Date('2026-10-05T00:00:00.000Z')
		const keys = (due: DayMarker[]) => due.map((marker) => `${marker.day}:${marker.scope}`)
		const first = await b.pending(at, 2)
		expect(keys(first)).toEqual(['20261002:Z', '20261002:a'])
		const last = first.at(-1)
		const second = await b.pending(at, 2, last)
		expect(keys(second)).toEqual(['20261002:aa', '20261002:b'])
		expect(keys(await b.pending(at, 10, second.at(-1)))).toEqual(['20261003:a'])
	})

	it('reads several scopes’ markers and cuts in one statement each', async () => {
		await a.ensureMarkers([
			{ scope: 'one', day: 20261001, tz: 'UTC' },
			{ scope: 'one', day: 20261003, tz: 'UTC' },
			{ scope: 'two', day: 20261002, tz: 'UTC' },
			{ scope: 'three', day: 20261002, tz: 'UTC' },
		])
		await a.recordPruned('two', new Date('2026-09-01T00:00:00.000Z'))
		const markers = await b.markersIn(['two', 'one', 'none'], 20261002, 20261005)
		expect(markers.map((marker) => `${marker.scope}:${marker.day}`)).toEqual([
			'one:20261003',
			'two:20261002',
		])
		expect(await b.prunedBeforeIn(['one', 'two'])).toEqual(
			new Map([['two', new Date('2026-09-01T00:00:00.000Z')]])
		)
		expect(await b.markersIn([], 20261001, 20261005)).toEqual([])
	})

	it('refuses a clean completion of a day marked dirty before its lease was claimed', async () => {
		const day = 20261005
		const key = dayKey('clean', day)
		await a.ensureMarkers([{ scope: 'clean', day, tz: 'UTC' }])
		await b.markDirty('clean', [day])
		expect(await a.claim(key, 'run-a', 10 * MINUTE)).toBe(true)
		const marker = await markerFor(a, 'clean', day)
		const empty: DayMarker = { ...(marker as DayMarker), status: 'empty', hits: 0, gen: null }
		expect(await a.complete(empty, 'run-a', { clean: true })).toBe(false)
		expect(await markerFor(b, 'clean', day)).toMatchObject({ status: 'dirty', leaseOwner: 'run-a' })
		expect(await a.complete({ ...empty, status: 'final', gen: 'run-a' }, 'run-a')).toBe(true)
	})

	it('keeps where a task’s run stopped for every instance, until a finished run clears it', async () => {
		expect(await a.cursor('analytics-sync')).toBeNull()
		await a.setCursor('analytics-sync', '"tenant-b"')
		expect(await b.cursor('analytics-sync')).toBe('"tenant-b"')
		await b.setCursor('analytics-sync', '"tenant-c"')
		expect(await a.cursor('analytics-sync')).toBe('"tenant-c"')
		await a.setCursor('analytics-sync', null)
		expect(await b.cursor('analytics-sync')).toBeNull()
		expect(await rowsFor('cursor:analytics-sync')).toBe(1)
	})

	it('creates each marker once, open, and leaves an existing one as it stands', async () => {
		await a.ensureMarkers([
			{ scope: 'm', day: 20261003, tz: 'America/New_York' },
			{ scope: 'm', day: 20261001, tz: 'America/New_York' },
		])
		await Promise.all([
			a.ensureMarkers([{ scope: 'm', day: 20261002, tz: 'UTC' }]),
			b.ensureMarkers([{ scope: 'm', day: 20261002, tz: 'UTC' }]),
			b.ensureMarkers([{ scope: 'm', day: 20261003, tz: 'UTC' }]),
		])
		const markers = await b.markers('m', 20260930, 20261004)
		expect(markers.map((marker) => [marker.day, marker.tz, marker.status])).toEqual([
			[20261001, 'America/New_York', 'open'],
			[20261002, 'UTC', 'open'],
			[20261003, 'America/New_York', 'open'],
		])
		expect(markers[0]?.finalAfter).toEqual(dayFinalAfter(20261001, 'America/New_York'))
		expect(await a.markers('other', 20261001, 20261003)).toEqual([])
		expect(await a.markers('m', 20261004, 20261001)).toEqual([])
	})

	it('lists due days oldest first, by status and time, and leaves leased days out', async () => {
		await a.ensureMarkers([
			{ scope: 'p1', day: 20261001, tz: 'UTC' },
			{ scope: 'p1', day: 20261002, tz: 'UTC' },
			{ scope: 'p0', day: 20261002, tz: 'UTC' },
			{ scope: 'p0', day: 20261003, tz: 'UTC' },
		])
		const due = async (at: string, limit = 10) =>
			(await a.pending(new Date(at), limit)).map((marker) => `${marker.scope}:${marker.day}`)
		// 2026-10-02 ended at midnight UTC and is due a quarter hour later.
		expect(await due('2026-10-03T00:10:00.000Z')).toEqual(['p1:20261001'])
		expect(await due('2026-10-03T00:15:00.000Z')).toEqual([
			'p1:20261001',
			'p0:20261002',
			'p1:20261002',
		])
		expect(await due('2026-10-03T00:15:00.000Z', 2)).toEqual(['p1:20261001', 'p0:20261002'])

		clock.at = Date.parse('2026-10-03T00:20:00.000Z')
		expect(await a.claim(dayKey('p0', 20261002), 'run', 10 * MINUTE)).toBe(true)
		expect(await due('2026-10-03T00:20:00.000Z')).toEqual(['p1:20261001', 'p1:20261002'])
		const settled = (await markerFor(a, 'p0', 20261002)) as DayMarker
		expect(
			await a.complete({ ...settled, status: 'provisional', gen: 'run', hits: 1 }, 'run')
		).toBe(true)
		const final = (await markerFor(a, 'p1', 20261001)) as DayMarker
		expect(await a.claim(dayKey('p1', 20261001), 'run', 10 * MINUTE)).toBe(true)
		expect(await a.complete({ ...final, status: 'final', gen: 'run', hits: 5 }, 'run')).toBe(true)
		expect(await due('2026-10-03T00:20:00.000Z')).toEqual(['p1:20261002'])
		// The provisional day turns final a day and a quarter hour after its end.
		expect(await due('2026-10-04T00:15:00.000Z')).toEqual([
			'p0:20261002',
			'p1:20261002',
			'p0:20261003',
		])
		await a.markDirty('p1', [20261001])
		expect(await due('2026-10-03T00:20:00.000Z')).toEqual(['p1:20261001', 'p1:20261002'])
	})

	it('keeps where a day’s count started, when not at its own start, through completion', async () => {
		const day = 20261005
		const key = dayKey('seam', day)
		await a.ensureMarkers([{ scope: 'seam', day, tz: 'Asia/Tokyo' }])
		expect(await a.claim(key, 'run', 10 * MINUTE)).toBe(true)
		const seam = new Date('2026-10-05T00:00:00.000Z')
		const opened = (await markerFor(a, 'seam', day)) as DayMarker
		expect(opened.start).toBeNull()
		const done: DayMarker = {
			...opened,
			start: seam,
			status: 'provisional',
			version: 1,
			gen: 'G1',
			hits: 3,
			aggregatedAt: now(),
		}
		expect(await a.complete(done, 'run')).toBe(true)
		expect((await markerFor(b, 'seam', day))?.start).toEqual(seam)
		await b.markDirty('seam', [day])
		expect(await markerFor(a, 'seam', day)).toMatchObject({ status: 'dirty', start: seam })
		expect(await a.claim(key, 'run-2', 10 * MINUTE)).toBe(true)
		expect(await a.complete({ ...done, start: null, gen: 'G2' }, 'run-2')).toBe(true)
		expect((await markerFor(b, 'seam', day))?.start).toBeNull()
	})

	it('records where a scope’s raw hits were cut, never moving it back', async () => {
		expect(await a.prunedBefore('cut')).toBeNull()
		await a.recordPruned('cut', new Date('2026-10-05T00:00:00.000Z'))
		await b.recordPruned('cut', new Date('2026-10-01T00:00:00.000Z'))
		expect(await b.prunedBefore('cut')).toEqual(new Date('2026-10-05T00:00:00.000Z'))
		await b.recordPruned('cut', new Date('2026-10-06T00:00:00.000Z'))
		expect(await a.prunedBefore('cut')).toEqual(new Date('2026-10-06T00:00:00.000Z'))
		expect(await a.prunedBefore('other')).toBeNull()
		expect(await rowsFor('pruned:cut')).toBe(1)
	})

	it('names the zone of a scope’s newest counted day, and every scope holding a marker', async () => {
		await a.ensureMarkers([
			{ scope: 'z', day: 20261003, tz: 'UTC' },
			{ scope: 'z', day: 20261004, tz: 'Asia/Tokyo' },
			{ scope: 'z', day: 20261006, tz: 'Europe/Berlin' },
			{ scope: 'y', day: 20261006, tz: 'UTC' },
		])
		expect(await b.lastZone('z')).toBeNull()
		for (const day of [20261003, 20261004]) {
			expect(await a.claim(dayKey('z', day), 'run', 10 * MINUTE)).toBe(true)
			const open = (await markerFor(a, 'z', day)) as DayMarker
			expect(
				await a.complete(
					{ ...open, status: 'final', gen: 'G', hits: 1, aggregatedAt: now() },
					'run'
				)
			).toBe(true)
		}
		expect(await b.lastZone('z')).toBe('Asia/Tokyo')
		expect(await b.lastZone('y')).toBeNull()
		expect(await b.scopes()).toEqual(['y', 'z'])
	})

	it('keeps drop notes of any age until they are cleared', async () => {
		const note = { scope: 'd', day: 20261005, gen: '01J0000000000000000000000A' }
		await a.noteDrop(note)
		await a.noteDrop(note)
		await b.noteDrop({ ...note, day: 20261004, gen: '01J0000000000000000000000B' })
		advance(40 * 60 * MINUTE)
		expect(await b.drops(10)).toEqual([
			{ scope: 'd', day: 20261004, gen: '01J0000000000000000000000B' },
			note,
		])
		expect(await b.drops(1)).toHaveLength(1)
		await b.clearDrop(note)
		expect(await a.drops(10)).toEqual([
			{ scope: 'd', day: 20261004, gen: '01J0000000000000000000000B' },
		])
	})

	it('sweeps the salts whose third UTC day has begun, and only those', async () => {
		const kept = await a.salt(20261004)
		await Promise.all([a.salt(20261001), a.salt(20261002), a.salt(20261003)])
		await a.beat('analytics-maintain')
		expect(await b.sweep(new Date('2026-10-05T23:59:59.999Z'))).toBe(2)
		expect(await rowsFor(saltKey(20261001))).toBe(0)
		expect(await rowsFor(saltKey(20261002))).toBe(0)
		expect(await rowsFor(saltKey(20261003))).toBe(1)
		expect(await b.sweep(new Date('2026-10-06T00:00:00.000Z'))).toBe(1)
		expect(await b.sweep(new Date('2026-10-06T00:00:00.000Z'))).toBe(0)
		expect(await b.salt(20261004)).toBe(kept)
		expect(await b.lastBeat('analytics-maintain')).not.toBeNull()
	})

	it('records when a task last finished, for every instance to read', async () => {
		const interval = 15 * MINUTE
		expect(await a.lastBeat('analytics-maintain')).toBeNull()
		await a.beat('analytics-maintain')
		expect(await b.lastBeat('analytics-maintain')).toEqual(now())
		advance(31 * MINUTE)
		expect(heartbeatStale(await b.lastBeat('analytics-maintain'), interval, now())).toBe(true)
		await b.beat('analytics-maintain')
		expect(await a.lastBeat('analytics-maintain')).toEqual(now())
		expect(heartbeatStale(await a.lastBeat('analytics-maintain'), interval, now())).toBe(false)
		expect(await a.lastBeat('analytics-sync')).toBeNull()
		expect(await rowsFor('heartbeat:analytics-maintain')).toBe(1)
	})

	// SQLite runs no transaction unless the host sets transactionOptions, and then a write outside
	// it waits on its lock: the store never takes part in one either way.
	it.runIf(db !== 'sqlite')(
		'keeps its writes when a transaction the host had open rolls back',
		async () => {
			const { payload } = first
			const transactionID = await payload.db.beginTransaction()
			expect(transactionID).toBeTruthy()
			await a.ensureMarkers([{ scope: 'host', day: 20261005, tz: 'UTC' }])
			expect(await a.claim(leaseKey('host'), 'run', MINUTE)).toBe(true)
			if (transactionID) {
				await payload.db.rollbackTransaction(transactionID)
			}
			expect(await rowsFor(dayKey('host', 20261005))).toBe(1)
			expect(await rowsFor(leaseKey('host'))).toBe(1)
		}
	)
})
