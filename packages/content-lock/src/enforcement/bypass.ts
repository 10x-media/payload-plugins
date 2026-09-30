import { AsyncLocalStorage } from 'node:async_hooks'

const SCOPE = Symbol.for('@10x-media/content-lock:bypassScope')

type ScopeHolder = Record<symbol, AsyncLocalStorage<true> | undefined>

// Held on globalThis because Next.js can evaluate this module in more than one server graph, and
// a scope opened through one copy has to reach the guard running in another.
const holder = globalThis as unknown as ScopeHolder
const scope = holder[SCOPE] ?? new AsyncLocalStorage<true>()
holder[SCOPE] = scope

/**
 * Run `fn` with every content lock lifted for the writes it makes: the maintenance a lock exists
 * to protect (migrations, imports, restores). Covers every Local API call in `fn`'s async chain,
 * the hooks those calls run and the calls they make, including work `fn` starts and leaves
 * running. Requests handled meanwhile stay locked, and the lock is still reported: the banner,
 * `isContentLocked` and paused queues are unchanged. Never wrap a request handler or a job run.
 */
export const withoutContentLock = <T>(fn: () => T): Promise<Awaited<T>> =>
	scope.run(true, async (): Promise<Awaited<T>> => await fn())

/** Whether the calling code runs inside `withoutContentLock`. */
export const isLockLifted = (): boolean => scope.getStore() === true
