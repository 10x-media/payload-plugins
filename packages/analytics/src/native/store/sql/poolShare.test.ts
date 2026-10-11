import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PgPool, pgDriver } from './drivers'
import {
	createPoolShare,
	DEFAULT_PG_POOL_MAX,
	PoolWaitTimeoutError,
	poolMaxOf,
	poolShareFor,
} from './poolShare'

const settle = () => new Promise((resolve) => setImmediate(resolve))

afterEach(() => {
	vi.useRealTimers()
})

/** A pool whose queries and checkouts all wait until `open` lets them go, counting what is out. */
const gatedPool = (max?: number) => {
	let release: () => void = () => undefined
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const state = { out: 0, most: 0 }
	const hold = async () => {
		state.out += 1
		state.most = Math.max(state.most, state.out)
		await gate
		state.out -= 1
	}
	const pool: PgPool & { options?: { max: number } } = {
		...(max === undefined ? {} : { options: { max } }),
		query: async () => {
			await hold()
			return { rows: [], rowCount: 0 }
		},
		connect: async () => {
			state.out += 1
			state.most = Math.max(state.most, state.out)
			return {
				query: async (text) => {
					if (text !== 'COMMIT' && !text.startsWith('BEGIN')) {
						await gate
					}
					return { rows: [], rowCount: 0 }
				},
				release: () => {
					state.out -= 1
				},
			}
		},
	}
	return { pool, state, open: () => release() }
}

describe('createPoolShare', () => {
	it('gives long work a third of the pool and all its work all but one connection, one at least', () => {
		expect(createPoolShare(10)).toMatchObject({ limit: 9, longLimit: 3 })
		expect(createPoolShare(30)).toMatchObject({ limit: 29, longLimit: 10 })
		expect(createPoolShare(5)).toMatchObject({ limit: 4, longLimit: 1 })
		expect(createPoolShare(3)).toMatchObject({ limit: 2, longLimit: 1 })
		expect(createPoolShare(2)).toMatchObject({ limit: 1, longLimit: 1 })
		expect(createPoolShare(1)).toMatchObject({ limit: 1, longLimit: 1 })
	})

	it('reads the size node-postgres keeps, its default when the pool says none', () => {
		expect(poolMaxOf({ options: { max: 20 } })).toBe(20)
		expect(poolMaxOf({})).toBe(DEFAULT_PG_POOL_MAX)
		expect(poolMaxOf({ options: { max: 0 } })).toBe(DEFAULT_PG_POOL_MAX)
		const pool = {}
		expect(poolShareFor(pool)).toBe(poolShareFor(pool))
	})

	it('hands a freed connection to waiting short work before long work', async () => {
		const share = createPoolShare(2)
		const order: string[] = []
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const first = share.run('long', () => gate)
		const long = share.run('long', async () => {
			order.push('long')
		})
		const short = share.run('short', async () => {
			order.push('short')
		})
		await settle()
		expect(order).toEqual([])
		release()
		await Promise.all([first, long, short])
		expect(order).toEqual(['short', 'long'])
		expect(share.held()).toEqual({ long: 0, short: 0 })
	})

	it('drops queued work whose signal aborts, and never runs it once a connection frees', async () => {
		const share = createPoolShare(2)
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const first = share.run('long', () => gate)
		const ran: string[] = []
		const controller = new AbortController()
		const outcome: { reason?: unknown } = {}
		const queued = share
			.run(
				'long',
				async () => {
					ran.push('late')
				},
				{ signal: controller.signal }
			)
			.catch((err: unknown) => {
				outcome.reason = err
			})
		await settle()
		controller.abort(new Error('the read gave up'))
		await settle()
		expect(outcome.reason).toEqual(new Error('the read gave up'))
		release()
		await Promise.all([first, queued])
		await settle()
		expect(ran).toEqual([])
		expect(share.held()).toEqual({ long: 0, short: 0 })
	})

	it('refuses at once work whose signal already aborted', async () => {
		const share = createPoolShare(10)
		const controller = new AbortController()
		controller.abort(new Error('gone'))
		const ran: string[] = []
		await expect(
			share.run('short', async () => ran.push('ran'), { signal: controller.signal })
		).rejects.toThrow('gone')
		expect(ran).toEqual([])
	})

	it('drops queued work that waits past its timeout with a PoolWaitTimeoutError', async () => {
		vi.useFakeTimers()
		const share = createPoolShare(2)
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const first = share.run('long', () => gate)
		const ran: string[] = []
		const queued = share.run('long', async () => ran.push('late'), { timeoutMs: 50 })
		const refused = expect(queued).rejects.toBeInstanceOf(PoolWaitTimeoutError)
		await vi.advanceTimersByTimeAsync(50)
		await refused
		release()
		await first
		await vi.advanceTimersByTimeAsync(0)
		expect(ran).toEqual([])
	})
})

describe('pgDriver on a share of the pool', () => {
	it('holds long reads to a third of a pool of 10 and everything to nine, beacons beside them', async () => {
		const { pool, state, open } = gatedPool(10)
		const driver = pgDriver(pool, () => [])
		const reads = Array.from({ length: 6 }, () => driver.run('SELECT long', [], { kind: 'long' }))
		const counts = Array.from({ length: 2 }, () =>
			driver.transaction(async (session) => session.run('SELECT count', []), { analytical: true })
		)
		await settle()
		expect(state.out).toBe(3)
		const beacons = Array.from({ length: 8 }, () => driver.write('INSERT hit', []))
		await settle()
		expect(state.out).toBe(9)
		open()
		await Promise.all([...reads, ...counts, ...beacons])
		expect(state.most).toBe(9)
	})

	it('takes one connection at a time from a pool of 2 or fewer', async () => {
		const { pool, state, open } = gatedPool(2)
		const driver = pgDriver(pool, () => [])
		const work = [
			driver.run('SELECT 1', [], { kind: 'long' }),
			driver.write('INSERT 1', []),
			driver.transaction(async (session) => session.run('UPDATE 1', []), {}),
		]
		await settle()
		expect(state.out).toBe(1)
		open()
		await Promise.all(work)
		expect(state.most).toBe(1)
	})

	it('never sends a read that gave up waiting for a connection, and gives a later one the time left', async () => {
		vi.useFakeTimers()
		const sent: string[] = []
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const pool: PgPool = {
			query: async (text) => {
				sent.push(text)
				await gate
				return { rows: [], rowCount: 0 }
			},
			connect: async () => ({
				query: async (text) => {
					sent.push(text)
					return { rows: [], rowCount: 0 }
				},
				release: () => undefined,
			}),
		}
		const timeouts: Array<number | undefined> = []
		const driver = pgDriver(
			pool,
			(options) => {
				timeouts.push(options.timeoutMs)
				return []
			},
			createPoolShare(2)
		)
		const holding = driver.run('SELECT held', [], { kind: 'long' })
		const timedOut = driver.transaction(async (session) => session.run('SELECT timed out', []), {
			analytical: true,
			timeoutMs: 50,
		})
		const timedOutRefused = expect(timedOut).rejects.toBeInstanceOf(PoolWaitTimeoutError)
		const controller = new AbortController()
		const aborted = driver.run('SELECT aborted', [], {
			kind: 'long',
			signal: controller.signal,
		})
		const abortedRefused = expect(aborted).rejects.toThrow('the read gave up')
		const waiting = driver.transaction(async (session) => session.run('SELECT waited', []), {
			analytical: true,
			timeoutMs: 1_000,
		})
		await vi.advanceTimersByTimeAsync(100)
		controller.abort(new Error('the read gave up'))
		await vi.advanceTimersByTimeAsync(300)
		await Promise.all([timedOutRefused, abortedRefused])
		release()
		await Promise.all([holding, waiting])
		expect(sent.filter((text) => text.startsWith('SELECT'))).toEqual([
			'SELECT held',
			'SELECT waited',
		])
		expect(timeouts).toEqual([600])
	})
})
