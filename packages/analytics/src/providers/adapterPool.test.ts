import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { createAdapterPool, POOL_IDLE_MS, type PooledDocument } from './adapterPool'

const warn = vi.fn()
const payload = { logger: { warn } } as unknown as Payload

const query: AnalyticsQuery = {
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

/** An adapter whose `close` is a spy and whose reads wait on `gate` when one is set. */
const closable = (id: string) => {
	const close = vi.fn(async (_payload: Payload) => {})
	let gate: Promise<void> | undefined
	const adapter: AnalyticsAdapter = {
		...memoryAdapter(),
		id,
		close,
		query: async (q): Promise<AnalyticsResult> => {
			await gate
			return { rows: [], meta: { provider: id, fetchedAt: q.dateRange.end.toISOString() } }
		},
	}
	return {
		adapter,
		close,
		hold: () => {
			let release = () => {}
			gate = new Promise((resolve) => {
				release = resolve
			})
			return () => release()
		},
	}
}

const doc = (id: string, version: string, scope: string | null = 'tenant-a'): PooledDocument => ({
	id,
	version,
	scope,
})

const V1 = '2026-10-07T12:00:00.000Z'
const V2 = '2026-10-07T12:05:00.000Z'

const setup = () => {
	let now = 0
	const disposed: PooledDocument[] = []
	const pool = createAdapterPool({
		payload,
		now: () => now,
		onDispose: (gone) => disposed.push(gone),
	})
	return { pool, disposed, advance: (ms: number) => (now += ms) }
}

afterEach(() => {
	vi.useRealTimers()
})

describe('createAdapterPool', () => {
	it('hands out the pooled adapter for an unchanged document, and nothing for one never built', () => {
		const { pool } = setup()
		const built = closable('plausible:1')
		expect(pool.get(doc('1', V1))).toBeUndefined()
		const pooled = pool.put(doc('1', V1), built.adapter, true)
		expect(pool.get(doc('1', V1))).toBe(pooled)
		expect(pool.get(doc('1', V2))).toBeUndefined()
		expect(pooled?.id).toBe('plausible:1')
	})

	it('pools a document that builds no adapter, so it is not read again either', () => {
		const { pool } = setup()
		pool.put(doc('1', V1), null, true)
		expect(pool.get(doc('1', V1))).toBeNull()
	})

	it('closes the old adapter once a newer version of its document is pooled', async () => {
		const { pool, disposed } = setup()
		const old = closable('plausible:1')
		pool.put(doc('1', V1), old.adapter, true)
		pool.put(doc('1', V2), closable('plausible:1').adapter, true)
		expect(old.close).toHaveBeenCalledWith(payload)
		expect(disposed).toEqual([doc('1', V1)])
		expect(pool.get(doc('1', V1))).toBeUndefined()
	})

	it('keeps the newer adapter when an older version arrives late', () => {
		const { pool } = setup()
		const newer = closable('plausible:1')
		const pooled = pool.put(doc('1', V2), newer.adapter, true)
		expect(pool.put(doc('1', V1), closable('plausible:1').adapter, true)).toBe(pooled)
		expect(newer.close).not.toHaveBeenCalled()
	})

	it('closes the adapter of a document its scope no longer holds, and only that one', () => {
		const { pool } = setup()
		const kept = closable('plausible:1')
		const removed = closable('umami:2')
		const elsewhere = closable('umami:3')
		pool.put(doc('1', V1), kept.adapter, true)
		pool.put(doc('2', V1), removed.adapter, true)
		pool.put(doc('3', V1, 'tenant-b'), elsewhere.adapter, true)
		pool.retain('tenant-a', new Set(['1']))
		expect(removed.close).toHaveBeenCalledTimes(1)
		expect(kept.close).not.toHaveBeenCalled()
		expect(elsewhere.close).not.toHaveBeenCalled()
		expect(pool.get(doc('2', V1))).toBeUndefined()
	})

	it('closes what nothing used for the idle window, and keeps what was used', () => {
		const { pool, advance } = setup()
		const idle = closable('plausible:1')
		const used = closable('umami:2')
		pool.put(doc('1', V1), idle.adapter, true)
		pool.put(doc('2', V1), used.adapter, true)
		advance(POOL_IDLE_MS - 1)
		pool.touch(['2'])
		advance(1)
		expect(pool.sweep()).toEqual(['1'])
		expect(idle.close).toHaveBeenCalledTimes(1)
		expect(used.close).not.toHaveBeenCalled()
		expect(pool.get(doc('2', V1))).toBeDefined()
	})

	it('sweeps on its own timer while anything is pooled', async () => {
		vi.useFakeTimers()
		const pool = createAdapterPool({ payload })
		const idle = closable('plausible:1')
		pool.put(doc('1', V1), idle.adapter, true)
		await vi.advanceTimersByTimeAsync(POOL_IDLE_MS + 60_000)
		expect(idle.close).toHaveBeenCalledTimes(1)
	})

	it('waits for a read in flight before closing a disposed adapter', async () => {
		const { pool } = setup()
		const built = closable('ga4:1')
		const pooled = pool.put(doc('1', V1), built.adapter, true)
		const release = built.hold()
		const reading = pooled?.query(query, {})
		pool.retain('tenant-a', new Set())
		expect(built.close).not.toHaveBeenCalled()
		release()
		await reading
		expect(built.close).toHaveBeenCalledTimes(1)
	})

	it('closes again after a read that reached a disposed adapter late', async () => {
		const { pool } = setup()
		const built = closable('ga4:1')
		const pooled = pool.put(doc('1', V1), built.adapter, true)
		pool.retain('tenant-a', new Set())
		expect(built.close).toHaveBeenCalledTimes(1)
		await pooled?.query(query, {})
		expect(built.close).toHaveBeenCalledTimes(2)
	})

	it('never closes an adapter it does not own', async () => {
		const { pool } = setup()
		const lent = closable('native')
		expect(pool.put(doc('1', V1), lent.adapter, false)).toBe(lent.adapter)
		pool.retain('tenant-a', new Set())
		await pool.close()
		expect(lent.close).not.toHaveBeenCalled()
	})

	it('closes everything it holds when closed, and logs a close that fails', async () => {
		warn.mockClear()
		const { pool } = setup()
		const first = closable('plausible:1')
		const second = closable('umami:2')
		second.close.mockRejectedValueOnce(new Error('channel gone'))
		pool.put(doc('1', V1), first.adapter, true)
		pool.put(doc('2', V1), second.adapter, true)
		await pool.close()
		expect(first.close).toHaveBeenCalledTimes(1)
		expect(second.close).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider document "2"'))
		expect(pool.get(doc('1', V1))).toBeUndefined()
	})
})
