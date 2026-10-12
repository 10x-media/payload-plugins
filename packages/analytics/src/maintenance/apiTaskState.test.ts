import type { Payload, Where } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { STATE_SLUG } from '../native/collections/slugs'
import { leaseKey } from '../native/store/state'
import { ANALYTICS_CONFIG_KEY } from '../plugin/routes'
import { apiTaskState } from './apiTaskState'
import { stateStoreOf } from './lease'

type Row = Record<string, unknown>

const PERIOD = 120_000
const KEY = leaseKey('analytics-sync')
/** The start of a lease slot, so a test can step through slots by whole periods. */
const SLOT_START = Math.ceil(Date.parse('2026-10-09T00:00:00.000Z') / PERIOD) * PERIOD

const comparable = (value: unknown): number | string =>
	typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : String(value)

const matches = (row: Row, where: Where): boolean =>
	Object.entries(where).every(([field, condition]) => {
		if (field === 'and') {
			return (condition as Where[]).every((each) => matches(row, each))
		}
		const value = row[field]
		const ops = condition as Record<string, unknown>
		return Object.entries(ops).every(([op, expected]) => {
			if (op === 'equals') return value === expected
			if (op === 'in') return (expected as unknown[]).includes(value)
			if (value === undefined || value === null) return false
			if (op === 'greater_than') return comparable(value) > comparable(expected)
			if (op === 'less_than') return comparable(value) < comparable(expected)
			throw new Error(`the fake has no ${op}`)
		})
	})

/**
 * Payload's database API over a map, as D1 answers it: every call settles on a later tick, and a
 * second `create` under one id is refused by the primary key.
 */
const fakeDatabase = (options: { packageName?: string; failCreates?: boolean } = {}) => {
	const rows = new Map<string, Row>()
	const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
	const db = {
		name: 'sqlite',
		packageName: options.packageName ?? '@payloadcms/db-d1-sqlite',
		find: async ({ where, limit }: { where: Where; limit?: number }) => {
			await tick()
			const docs = [...rows.values()].filter((row) => matches(row, where))
			return { docs: limit ? docs.slice(0, limit) : docs }
		},
		create: async ({ data }: { data: Row }) => {
			await tick()
			if (options.failCreates) {
				throw new Error('D1_ERROR: network connection lost')
			}
			const id = String(data.id)
			if (rows.has(id)) {
				throw new Error('D1_ERROR: UNIQUE constraint failed: analytics_state.id: SQLITE_CONSTRAINT')
			}
			rows.set(id, { ...data })
		},
		updateOne: async ({ id, data }: { id: string; data: Row }) => {
			await tick()
			const row = rows.get(id)
			if (row) rows.set(id, { ...row, ...data })
		},
		deleteMany: async ({ where }: { where: Where }) => {
			await tick()
			for (const [id, row] of rows) {
				if (matches(row, where)) rows.delete(id)
			}
		},
	}
	const payload = {
		db,
		collections: { [STATE_SLUG]: {} },
		config: {
			collections: [{ slug: STATE_SLUG, custom: { [ANALYTICS_CONFIG_KEY]: { role: 'state' } } }],
		},
		logger: { warn: vi.fn() },
	} as unknown as Payload
	return { payload, rows }
}

const storeAt = (payload: Payload, clock: { at: number }) =>
	apiTaskState(payload, { slug: STATE_SLUG, now: () => new Date(clock.at) })

describe('apiTaskState leases', () => {
	it('gives the lease to exactly one of several claimers that start together', async () => {
		const { payload } = fakeDatabase()
		const clock = { at: SLOT_START + 1000 }
		const state = storeAt(payload, clock)
		const owners = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

		const won = await Promise.all(owners.map((owner) => state.claim(KEY, owner, PERIOD)))

		expect(won.filter(Boolean)).toHaveLength(1)
		expect(await state.held(KEY)).toBe(true)
	})

	it('keeps it for a holder renewing every third of a period, across slot ends', async () => {
		const { payload, rows } = fakeDatabase()
		const clock = { at: SLOT_START + PERIOD - 1000 }
		const state = storeAt(payload, clock)
		expect(await state.claim(KEY, 'holder', PERIOD)).toBe(true)
		for (let step = 0; step < 9; step++) {
			clock.at += PERIOD / 3
			expect(await state.claim(KEY, 'other', PERIOD), `step ${step}`).toBe(false)
			expect(await state.claim(KEY, 'holder', PERIOD), `step ${step}`).toBe(true)
		}
		// Slots that ended a period ago are cleared as the lease moves on.
		expect(rows.size).toBeLessThanOrEqual(4)
	})

	it('lets another run in within two periods of a holder that stopped renewing, not before', async () => {
		const { payload } = fakeDatabase()
		const clock = { at: SLOT_START + PERIOD / 2 }
		const state = storeAt(payload, clock)
		expect(await state.claim(KEY, 'stopped', PERIOD)).toBe(true)

		clock.at = SLOT_START + PERIOD + 1000
		expect(await state.claim(KEY, 'next', PERIOD)).toBe(false)
		expect(await state.held(KEY)).toBe(true)
		clock.at = SLOT_START + 2 * PERIOD
		expect(await state.held(KEY)).toBe(false)
		expect(await state.claim(KEY, 'next', PERIOD)).toBe(true)
		expect(await state.claim(KEY, 'stopped', PERIOD)).toBe(false)
	})

	it('gives back a slot it took when the next one turns out taken', async () => {
		const { payload, rows } = fakeDatabase()
		const clock = { at: SLOT_START + PERIOD + 1000 }
		await storeAt(payload, clock).claim(KEY, 'ahead', PERIOD)
		clock.at = SLOT_START + PERIOD - 1000

		expect(await storeAt(payload, clock).claim(KEY, 'behind', PERIOD)).toBe(false)
		expect([...rows.values()].map((row) => row.leaseOwner)).not.toContain('behind')
	})

	it('releases only for its holder, and frees it for the next claimer', async () => {
		const { payload } = fakeDatabase()
		const clock = { at: SLOT_START + 1000 }
		const state = storeAt(payload, clock)
		await state.claim(KEY, 'holder', PERIOD)

		expect(await state.release(KEY, 'someone-else')).toBe(false)
		expect(await state.held(KEY)).toBe(true)
		expect(await state.release(KEY, 'holder')).toBe(true)
		expect(await state.held(KEY)).toBe(false)
		expect(await state.claim(KEY, 'next', PERIOD)).toBe(true)
	})

	it('fails a claim the database refused for another reason, rather than calling it lost', async () => {
		const { payload } = fakeDatabase({ failCreates: true })
		const state = storeAt(payload, { at: SLOT_START })

		await expect(state.claim(KEY, 'holder', PERIOD)).rejects.toThrow(/network connection lost/)
	})

	it('refuses a key that is not a lease, and a period that is not one', async () => {
		const { payload } = fakeDatabase()
		const state = storeAt(payload, { at: SLOT_START })

		await expect(state.claim('day::20261009', 'holder', PERIOD)).rejects.toThrow(/not a lease/)
		await expect(state.claim(KEY, 'holder', 0)).rejects.toThrow(RangeError)
	})
})

describe('apiTaskState heartbeats and cursors', () => {
	it('keeps the last beat, and two instances beating at once both land', async () => {
		const { payload } = fakeDatabase()
		const clock = { at: SLOT_START }
		const state = storeAt(payload, clock)
		expect(await state.lastBeat('analytics-sync')).toBeNull()

		await Promise.all([state.beat('analytics-sync'), state.beat('analytics-sync')])
		clock.at += 5000
		await state.beat('analytics-sync')

		expect(await state.lastBeat('analytics-sync')).toEqual(new Date(SLOT_START + 5000))
	})

	it('keeps where a task stopped, and null once it finished', async () => {
		const { payload } = fakeDatabase()
		const state = storeAt(payload, { at: SLOT_START })
		expect(await state.cursor('analytics-sync')).toBeNull()

		await state.setCursor('analytics-sync', '"tenant-a"')
		expect(await state.cursor('analytics-sync')).toBe('"tenant-a"')
		await state.setCursor('analytics-sync', null)
		expect(await state.cursor('analytics-sync')).toBeNull()
	})
})

describe('stateStoreOf on Cloudflare D1', () => {
	it('keeps the sync and warm leases, heartbeats and cursors through the database API', async () => {
		const { payload, rows } = fakeDatabase()
		const state = stateStoreOf(payload)
		expect(state).toBeDefined()

		expect(await state?.claim(KEY, 'holder', PERIOD)).toBe(true)
		expect(await state?.claim(KEY, 'other', PERIOD)).toBe(false)
		await state?.beat('analytics-sync')
		await state?.setCursor('analytics-sync', null)

		expect([...rows.keys()].map((id) => id.replace(/@\d+$/, '@slot')).sort()).toEqual([
			'cursor:analytics-sync',
			'heartbeat:analytics-sync',
			'lease:analytics-sync@slot',
			'lease:analytics-sync@slot',
		])
		expect(payload.logger.warn).not.toHaveBeenCalled()
	})
})
