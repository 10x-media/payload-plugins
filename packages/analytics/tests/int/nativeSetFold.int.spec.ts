import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import { isMongoOverLimit } from '../../src/db/errors'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { dayWindow } from '../../src/native/store/aggregate'
import { DEFAULT_CAPS } from '../../src/native/store/caps'
import { createEventStore } from '../../src/native/store/eventStore'
import { memoryStateStore } from '../../src/native/store/memory/memoryState'
import { memoryEventStore } from '../../src/native/store/memory/memoryStore'
import { DAY_LEASE_MS, dayKey } from '../../src/native/store/state'
import { createStateStore } from '../../src/native/store/stateStore'
import type { AggregateRead, EventStore, HitRow, StateStore } from '../../src/native/store/types'
import { calendarDayOf } from '../../src/timeframe/calendar'
import { fromGoogle, hitOf, internal } from './hitFixtures'

const SCOPE = 'set-fold'
const START = new Date('2026-09-28T00:00:00.000Z')
const DAY = calendarDayOf(START, 'UTC')
const MINUTE = 60_000

/**
 * The memory MongoDB lets one `$addToSet` take: as shipped, and a size the day's sets of visitors
 * outgrow while each visitor's own visits fit in it.
 */
const SET_BYTES = { usual: 104_857_600, small: 4096 }

/** Sets how much memory MongoDB lets one `$addToSet` take, on the server the boot runs on. */
const setBytes = async (payload: Payload, bytes: number): Promise<void> => {
	const connection: unknown = Reflect.get(payload.db, 'connection')
	const db: unknown = isRecord(connection) ? connection.db : undefined
	const admin: unknown = isRecord(db) && typeof db.admin === 'function' ? db.admin() : undefined
	if (!isRecord(admin) || typeof admin.command !== 'function') {
		throw new Error('the mongoose adapter holds no connection to set a server parameter on')
	}
	await admin.command({ setParameter: 1, internalQueryMaxAddToSetBytes: bytes })
}

/** Many one-visit visitors, a few coming back once: wide sets per row, small per visitor. */
const HITS: HitRow[] = Array.from({ length: 160 }, (_, person): HitRow[] => {
	const v = `S${String(person).padStart(15, '0')}`
	const ts = new Date(START.getTime() + (person * 7 + 1) * MINUTE)
	const landing = hitOf(SCOPE, { ts, v, path: `/p/${person % 9}`, ...fromGoogle() })
	return person % 10 === 0
		? [landing, hitOf(SCOPE, { ts: new Date(ts.getTime() + 2 * MINUTE), v, ...internal })]
		: [landing]
}).flat()

describeForDb('Mongo day folds past their set memory', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let state: StateStore
	const memoryState = memoryStateStore()
	const memory = memoryEventStore({ state: memoryState })

	const run = async (store: EventStore, coordination: StateStore, runId: string) => {
		await coordination.ensureMarkers([{ scope: SCOPE, day: DAY, tz: 'UTC' }])
		expect(await coordination.claim(dayKey(SCOPE, DAY), runId, DAY_LEASE_MS)).toBe(true)
		try {
			return await store.aggregateDay(dayWindow(SCOPE, DAY, 'UTC'), {
				runId,
				caps: DEFAULT_CAPS,
				status: 'final',
			})
		} finally {
			await coordination.release(dayKey(SCOPE, DAY), runId)
		}
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
		})
		state = createStateStore(booted.payload)
		await createEventStore(booted.payload).append(HITS)
		await memory.append(HITS)
		expect(await run(memory, memoryState, 'memory')).toMatchObject({ completed: true })
	}, 240_000)

	afterAll(async () => {
		await setBytes(booted.payload, SET_BYTES.usual).catch(() => undefined)
		await booted?.stop()
	})

	it(`folds per visitor once a set outgrows its memory, to the same rows, on ${db}`, async () => {
		await setBytes(booted.payload, SET_BYTES.small)
		try {
			const alone = createEventStore(booted.payload, { setFoldHits: Number.MAX_SAFE_INTEGER })
			const refused = await run(alone, state, 'sets alone').catch((err: unknown) => err)
			expect(isMongoOverLimit(refused)).toBe(true)
			const store = createEventStore(booted.payload, { setFoldHits: 0 })
			expect(await run(store, state, 'sets, then per visitor')).toMatchObject({
				completed: true,
				hits: HITS.length,
			})
		} finally {
			await setBytes(booted.payload, SET_BYTES.usual)
		}
		const store = createEventStore(booted.payload)
		const days = [[DAY, DAY]] as const
		const total: AggregateRead = { scope: SCOPE, days, dim: '', groupBy: 'total' }
		for (const read of [
			total,
			{ scope: SCOPE, days, dim: 'source', groupBy: 'value' } as const,
			{ scope: SCOPE, days, dim: 'page', groupBy: 'value' } as const,
		]) {
			expect(await store.readAggregates(read)).toEqual(await memory.readAggregates(read))
		}
		const [row] = await store.readAggregates(total)
		expect(row?.parts).toMatchObject({ visitors: 160, sessions: 160, pageviews: HITS.length })
	})
})
