import { isRecord } from '../../../core/values'

/** node-postgres' own default `max`, for a pool that does not say. */
export const DEFAULT_PG_POOL_MAX = 10

/** What work holds a connection for: a long read or count, or a short statement or write. */
export type PoolWork = 'long' | 'short'

/** What gives up on work still waiting for a connection, which is then dropped without running. */
export interface PoolWait {
	signal?: AbortSignal
	/** Ms the work may wait; past it the wait rejects with a {@link PoolWaitTimeoutError}. */
	timeoutMs?: number
}

/** Work that ran out of its time waiting for a connection, so it never ran. */
export class PoolWaitTimeoutError extends Error {
	readonly timeoutMs: number

	constructor(timeoutMs: number) {
		super(`analytics: no connection of the engine's pool share was free within ${timeoutMs} ms`)
		this.name = 'PoolWaitTimeoutError'
		this.timeoutMs = timeoutMs
	}
}

/** The engine's share of a host's pool: `limit` connections, `longLimit` of them for long work. */
export interface PoolShare {
	readonly limit: number
	readonly longLimit: number
	run<T>(kind: PoolWork, work: () => Promise<T>, wait?: PoolWait): Promise<T>
	/** Connections held now, by kind. */
	held(): { long: number; short: number }
}

interface Waiter {
	kind: PoolWork
	start: () => void
}

/**
 * Long reads and counts on a third of the pool, everything on all of it but one left to the host:
 * Postgres commits concurrent inserts together, so capping beacons harder costs more than it saves.
 */
export const createPoolShare = (poolMax: number): PoolShare => {
	const limit = Math.max(1, poolMax - 1)
	const longLimit = Math.min(Math.max(1, Math.floor(poolMax / 3)), limit > 1 ? limit - 1 : 1)
	const held = { long: 0, short: 0 }
	const waiting: Waiter[] = []

	const fits = (kind: PoolWork): boolean =>
		held.long + held.short < limit && (kind === 'short' || held.long < longLimit)

	const admit = (): void => {
		for (const kind of ['short', 'long'] as const) {
			for (let index = 0; index < waiting.length && fits(kind); ) {
				const next = waiting[index]
				if (next?.kind !== kind) {
					index += 1
					continue
				}
				waiting.splice(index, 1)
				held[kind] += 1
				next.start()
			}
		}
	}

	const queue = (kind: PoolWork, wait: PoolWait): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const { signal, timeoutMs } = wait
			let timer: ReturnType<typeof setTimeout> | undefined
			const settle = (): void => {
				clearTimeout(timer)
				signal?.removeEventListener('abort', onAbort)
			}
			const giveUp = (reason: unknown): void => {
				const index = waiting.indexOf(waiter)
				if (index === -1) {
					return
				}
				waiting.splice(index, 1)
				settle()
				reject(reason)
				admit()
			}
			const onAbort = (): void => giveUp(signal?.reason)
			const waiter: Waiter = {
				kind,
				start: () => {
					settle()
					resolve()
				},
			}
			waiting.push(waiter)
			signal?.addEventListener('abort', onAbort, { once: true })
			if (timeoutMs !== undefined) {
				timer = setTimeout(() => giveUp(new PoolWaitTimeoutError(timeoutMs)), timeoutMs)
				timer.unref?.()
			}
		})

	return {
		limit,
		longLimit,
		async run(kind, work, wait = {}) {
			if (wait.signal?.aborted) {
				throw wait.signal.reason
			}
			if (fits(kind) && !waiting.some((each) => kind === 'long' || each.kind === 'short')) {
				held[kind] += 1
			} else {
				await queue(kind, wait)
			}
			try {
				return await work()
			} finally {
				held[kind] -= 1
				admit()
			}
		},
		held: () => ({ ...held }),
	}
}

/** A pool's `options.max`, as node-postgres and `@vercel/postgres` keep it. */
export const poolMaxOf = (pool: object): number => {
	const options: unknown = Reflect.get(pool, 'options')
	const max = isRecord(options) ? options.max : undefined
	return typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : DEFAULT_PG_POOL_MAX
}

const shares = new WeakMap<object, PoolShare>()

/** The share every engine on `pool` keeps to, made on first use from the pool's own size. */
export const poolShareFor = (pool: object): PoolShare => {
	const known = shares.get(pool)
	if (known) {
		return known
	}
	const share = createPoolShare(poolMaxOf(pool))
	shares.set(pool, share)
	return share
}
