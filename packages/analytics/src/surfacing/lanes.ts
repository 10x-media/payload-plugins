import type { AnalyticsAdapter } from '../core/contract'
import { monotonicMs } from '../core/monotonic'
import { recallOr } from './bounded'
import { BREAKER_MAX_MS, type Breaker, type BreakerOptions, createBreaker } from './breaker'
import {
	classifyError,
	isLaneRefused,
	LaneRefusedError,
	type ReadFailure,
	type ReadFailureKind,
} from './classifyError'
import { createTokenSource, mostUrgent, type Priority } from './rateLimiter'

export type { Priority } from './rateLimiter'

/** Upstream requests in flight across every vendor source of one instance, by default. */
export const DEFAULT_GLOBAL_CONCURRENCY = 16

/** Upstream requests in flight per vendor source that declares no `rateLimit.maxConcurrent`. */
export const DEFAULT_SOURCE_CONCURRENCY = 4

/** Reads in flight on a local source (native), which stays outside the global cap. */
const DEFAULT_LOCAL_CONCURRENCY = 8

/** The fewest and most native reads in flight when the lane is sized from a Postgres pool. */
const MIN_POOLED_CONCURRENCY = 1
export const MAX_POOLED_CONCURRENCY = 8

/**
 * Native lane size on a host Postgres pool of `poolMax`: a third, capped at the engine's long-work
 * share, so reads queue in the lane (deadline and priority aware), not unseen for a connection.
 */
export const pooledConcurrency = (poolMax: number): number =>
	Math.min(MAX_POOLED_CONCURRENCY, Math.max(MIN_POOLED_CONCURRENCY, Math.floor(poolMax / 3)))

/** The slots one scope may hold at once in a lane every scope shares: half, rounded up. */
const scopeShareOf = (capacity: number): number => Math.max(1, Math.ceil(capacity / 2))

/** Retries of an upstream request that failed as `unavailable`, with backoff between them. */
const MAX_RETRIES = 2

/** The first backoff, 0.5 s; the second is 1.25 s (see {@link runUpstream}). */
export const RETRY_BASE_MS = 500

/**
 * How long a request may stay out after its signal aborted before its slots are given back: one
 * that honours the signal settles at once, and GA4's own gRPC deadline ends with the read.
 */
export const ABANDON_AFTER_MS = 5_000

export interface LaneRunOptions {
	signal: AbortSignal
	priority: Priority
	/** Epoch milliseconds the caller gives up at: a wait that would outlast it is refused at once. */
	deadline?: number
}

export interface LaneHealth {
	/** The lane refuses new requests right now: its breaker is open. */
	open: boolean
	/** Until the lane takes requests again, when open or the vendor asked it to wait. */
	retryAfterMs?: number
	/** What the failure that last counted against the lane meant, cleared by a success. */
	lastFailure?: ReadFailureKind
	/** That failure was a refused host. */
	hostRefused?: true
	/**
	 * Requests whose slots were given back while they were still out, having ignored their abort
	 * signal for {@link ABANDON_AFTER_MS}; absent while there are none.
	 */
	abandoned?: number
}

/**
 * One adapter's requests for one scope. A `run` takes a rate token, a lane slot and a global slot
 * in that order; the pause, tokens and slots are the adapter's, the breaker each scope's own.
 */
export interface Lane {
	run<T>(fn: (signal: AbortSignal) => Promise<T>, options: LaneRunOptions): Promise<T>
	health(): LaneHealth
}

export interface Lanes {
	/**
	 * The lane of one adapter instance for `scope`, made on first use; for an adapter built anew on
	 * every read, the lane of its id within `scope`.
	 */
	for(adapter: AnalyticsAdapter, scope?: string | null): Lane
}

export interface LanesOptions {
	/** Slots shared by every vendor source; default {@link DEFAULT_GLOBAL_CONCURRENCY}. */
	global?: number
	/** Slots of a source without `maxConcurrent`; default {@link DEFAULT_SOURCE_CONCURRENCY}. */
	perSource?: number
	/** Which sources are local (native), which get their own lane outside the global cap. */
	local?: { is: (adapter: AnalyticsAdapter) => boolean; capacity?: number }
	/** Clock for waits and deadlines; the timers' monotonic one (`monotonicMs`) by default. */
	now?: () => number
	/**
	 * Adapters built anew per read (`providers.resolve`): keyed by scope and id rather than object,
	 * so each keeps one lane, and two tenants' sources of one id never share a breaker.
	 */
	rebuilt?: (adapter: AnalyticsAdapter) => boolean
	/**
	 * Which adapters serve every scope through one lane (the config adapters of a scoped install):
	 * one scope holds at most {@link scopeShareOf} of their slots, so another always gets one.
	 */
	shared?: (adapter: AnalyticsAdapter) => boolean
	breaker?: Omit<BreakerOptions, 'now'>
	/** How long a request may ignore its abort before its slots return; {@link ABANDON_AFTER_MS}. */
	abandonAfterMs?: number
	/** Told the first time a lane gives back the slots of a request that ignored its abort signal. */
	onAbandon?: (adapter: AnalyticsAdapter) => void
}

type Release = () => void

/** The install-wide scope (null) is keyed `''`; it never counts against a scope's share. */
const UNSCOPED = ''

const scopeKeyOf = (scope: string | null | undefined): string =>
	scope === null || scope === undefined ? UNSCOPED : `s:${scope}`

interface Slots {
	acquire(priority: Priority, signal: AbortSignal, scope?: string): Promise<Release>
}

interface SlotWaiter {
	priority: Priority
	scope: string
	grant: () => void
}

/**
 * A counting semaphore serving the most urgent waiter first, never more than `backgroundCap` slots
 * to background work, and, given a `scopeCap`, never more than that many to one scope.
 */
const createSlots = (capacity: number, backgroundCap: number, scopeCap?: number): Slots => {
	let active = 0
	let background = 0
	const waiters: SlotWaiter[] = []
	const heldBy = new Map<string, number>()

	const withinShare = (waiter: SlotWaiter): boolean =>
		scopeCap === undefined ||
		waiter.scope === UNSCOPED ||
		(heldBy.get(waiter.scope) ?? 0) < scopeCap

	const pick = (): SlotWaiter | undefined =>
		mostUrgent(
			waiters.filter(
				(waiter) =>
					withinShare(waiter) && (waiter.priority !== 'background' || background < backgroundCap)
			)
		)

	const hold = (scope: string, by: number): void => {
		const next = (heldBy.get(scope) ?? 0) + by
		if (next > 0) {
			heldBy.set(scope, next)
		} else {
			heldBy.delete(scope)
		}
	}

	const pump = (): void => {
		while (active < capacity) {
			const chosen = pick()
			if (!chosen) {
				return
			}
			waiters.splice(waiters.indexOf(chosen), 1)
			active++
			hold(chosen.scope, 1)
			if (chosen.priority === 'background') {
				background++
			}
			chosen.grant()
		}
	}

	return {
		acquire(priority, signal, scope = UNSCOPED) {
			if (signal.aborted) {
				return Promise.reject(signal.reason)
			}
			return new Promise<Release>((resolve, reject) => {
				let released = false
				const release = (): void => {
					if (released) {
						return
					}
					released = true
					active--
					hold(scope, -1)
					if (priority === 'background') {
						background--
					}
					pump()
				}
				const onAbort = (): void => {
					const index = waiters.indexOf(waiter)
					if (index !== -1) {
						waiters.splice(index, 1)
					}
					reject(signal.reason)
				}
				const waiter: SlotWaiter = {
					priority,
					scope,
					grant: () => {
						signal.removeEventListener('abort', onAbort)
						resolve(release)
					},
				}
				waiters.push(waiter)
				signal.addEventListener('abort', onAbort, { once: true })
				pump()
			})
		},
	}
}

/** Resolves after `ms`, or rejects with the signal's reason once it aborts. */
const sleep = (ms: number, signal: AbortSignal): Promise<void> => {
	if (signal.aborted) {
		return Promise.reject(signal.reason)
	}
	return new Promise<void>((resolve, reject) => {
		const onAbort = (): void => {
			clearTimeout(timer)
			reject(signal.reason)
		}
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		signal.addEventListener('abort', onAbort, { once: true })
	})
}

/**
 * Settles with `work`, or rejects with the signal's reason first: the slot stays held until `work`
 * settles, or until {@link ABANDON_AFTER_MS} after the abort for work that never does.
 */
const untilAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => {
	if (signal.aborted) {
		return Promise.reject(signal.reason)
	}
	let onAbort: (() => void) | undefined
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(signal.reason)
		signal.addEventListener('abort', onAbort, { once: true })
	})
	return Promise.race([work, aborted]).finally(() => {
		if (onAbort) {
			signal.removeEventListener('abort', onAbort)
		}
	})
}

const noRelease: Release = () => {}

interface LaneSetup {
	adapter: AnalyticsAdapter
	capacity: number
	global: Slots | undefined
	now: () => number
	/** Every scope reads through this lane: each holds at most its share of the slots. */
	shared: boolean
	breaker?: Omit<BreakerOptions, 'now'>
	abandonAfterMs: number
	onAbandon?: (adapter: AnalyticsAdapter) => void
}

/** What a request that ignored its abort counts as against the breaker. */
const ABANDONED: ReadFailure = { kind: 'unavailable', timeout: true }

/** A breaker with nothing to remember: closed, no failure counted since its last answer. */
const isClean = (breaker: Breaker): boolean => {
	const snapshot = breaker.snapshot()
	return snapshot.state === 'closed' && snapshot.lastFailure === undefined
}

/** One adapter's pause, tokens and slots, and one breaker per scope reading through them. */
const createLaneCore = (setup: LaneSetup): ((scope: string | null | undefined) => Lane) => {
	const { now } = setup
	const tokens = createTokenSource(setup.adapter.capabilities.rateLimit, now)
	const slots = createSlots(
		setup.capacity,
		Math.max(1, Math.floor(setup.capacity / 2)),
		setup.shared ? scopeShareOf(setup.capacity) : undefined
	)
	const breakers = new Map<string, Breaker>()
	const views = new Map<string, Lane>()
	let pausedUntil = 0
	let abandoned = 0

	const breakerOf = (key: string): Breaker =>
		recallOr(
			breakers,
			[key, () => createBreaker({ now, ...setup.breaker })],
			(breaker) => !isClean(breaker)
		)

	const waitOutPause = async (options: LaneRunOptions): Promise<void> => {
		for (;;) {
			const pausedFor = pausedUntil - now()
			if (pausedFor <= 0) {
				return
			}
			if (options.deadline !== undefined && pausedUntil > options.deadline) {
				throw new LaneRefusedError('paused', pausedFor)
			}
			await sleep(pausedFor, options.signal)
		}
	}

	const viewOf = (key: string): Lane => ({
		async run(fn, options) {
			const { signal, priority } = options
			if (signal.aborted) {
				throw signal.reason
			}
			const breaker = breakerOf(key)
			const refusedOpen = (retryAfterMs: number): LaneRefusedError =>
				new LaneRefusedError('open', retryAfterMs, breaker.snapshot().lastFailure)
			const peek = breaker.peek()
			if (!peek.ok) {
				throw refusedOpen(peek.retryAfterMs)
			}
			// A breaker due its probe lets one run through: it is claimed before the run spends a rate
			// token or waits for a slot, so the runs it turns away spend nothing.
			const claimed = peek.probe ? breaker.admit() : undefined
			if (claimed && !claimed.ok) {
				throw refusedOpen(claimed.retryAfterMs)
			}
			let releaseLane = noRelease
			let releaseGlobal = noRelease
			const releaseSlots = (): void => {
				releaseGlobal()
				releaseLane()
			}
			try {
				await waitOutPause(options)
				await tokens.take({ signal, priority })
				releaseLane = await slots.acquire(priority, signal, key)
				releaseGlobal = setup.global ? await setup.global.acquire(priority, signal) : noRelease
			} catch (err) {
				releaseSlots()
				if (claimed?.probe) {
					breaker.release()
				}
				throw err
			}
			const admission = claimed ?? breaker.admit()
			if (!admission.ok) {
				releaseSlots()
				throw refusedOpen(admission.retryAfterMs)
			}
			let counted = false
			const record = (outcome: 'success' | ReadFailure): void => {
				if (!counted) {
					counted = true
					breaker.record(outcome, admission.probe)
				}
			}
			const settled = (async () => fn(signal))().then(
				(value) => {
					record('success')
					return value
				},
				(err: unknown) => {
					const failure = classifyError(err)
					record(failure)
					if (failure.kind === 'unavailable' && failure.retryAfterMs !== undefined) {
						pausedUntil = Math.max(
							pausedUntil,
							now() + Math.min(failure.retryAfterMs, BREAKER_MAX_MS)
						)
					}
					throw err
				}
			)
			let abandonTimer: ReturnType<typeof setTimeout> | undefined
			// Past the grace a request that ignores its abort gives its slots back, counted as a timeout.
			const abandon = (): void => {
				abandonTimer = setTimeout(() => {
					releaseSlots()
					record(ABANDONED)
					abandoned++
					if (abandoned === 1) {
						setup.onAbandon?.(setup.adapter)
					}
				}, setup.abandonAfterMs)
				abandonTimer.unref?.()
			}
			if (signal.aborted) {
				abandon()
			} else {
				signal.addEventListener('abort', abandon, { once: true })
			}
			const done = settled.finally(() => {
				signal.removeEventListener('abort', abandon)
				clearTimeout(abandonTimer)
				releaseSlots()
			})
			// The caller may stop waiting at the abort; the request still settles, and is not unhandled.
			done.catch(() => {})
			return untilAborted(done, signal)
		},
		health() {
			const breaker = breakers.get(key)
			const snapshot = breaker?.snapshot()
			const peek = breaker?.peek() ?? { ok: true as const, probe: false }
			const pausedFor = pausedUntil - now()
			const retryAfterMs = Math.max(peek.ok ? 0 : peek.retryAfterMs, pausedFor > 0 ? pausedFor : 0)
			const last = snapshot?.lastFailure
			return {
				open: !peek.ok,
				...(retryAfterMs > 0 ? { retryAfterMs } : {}),
				...(last ? { lastFailure: last.kind } : {}),
				...(last?.hostRefused ? { hostRefused: true as const } : {}),
				...(abandoned > 0 ? { abandoned } : {}),
			}
		},
	})

	return (scope) => {
		const key = scopeKeyOf(scope)
		return recallOr(views, [key, () => viewOf(key)])
	}
}

/**
 * One lane per adapter object, so a re-saved provider starts fresh. Vendor lanes share the global
 * slots; local (native) lanes do not, so a slow vendor never queues the plugin's own reads.
 */
export const createLanes = (options: LanesOptions = {}): Lanes => {
	const now = options.now ?? monotonicMs
	const globalCapacity = options.global ?? DEFAULT_GLOBAL_CONCURRENCY
	const global = createSlots(globalCapacity, globalCapacity)
	const cores = new WeakMap<AnalyticsAdapter, (scope: string | null | undefined) => Lane>()
	const lanesById = new Map<string, Lane>()

	const coreFor = (adapter: AnalyticsAdapter): ((scope: string | null | undefined) => Lane) => {
		const local = options.local?.is(adapter) === true
		const declared = adapter.capabilities.rateLimit?.maxConcurrent
		const fallback = local
			? (options.local?.capacity ?? DEFAULT_LOCAL_CONCURRENCY)
			: (options.perSource ?? DEFAULT_SOURCE_CONCURRENCY)
		return createLaneCore({
			adapter,
			capacity: declared !== undefined && declared > 0 ? declared : fallback,
			global: local ? undefined : global,
			now,
			shared: options.shared?.(adapter) === true,
			...(options.breaker ? { breaker: options.breaker } : {}),
			abandonAfterMs: options.abandonAfterMs ?? ABANDON_AFTER_MS,
			...(options.onAbandon ? { onAbandon: options.onAbandon } : {}),
		})
	}

	return {
		for(adapter, scope) {
			if (options.rebuilt?.(adapter) === true) {
				const id = JSON.stringify([scope ?? null, adapter.id])
				return recallOr(lanesById, [id, () => coreFor(adapter)(scope)])
			}
			const core = cores.get(adapter) ?? coreFor(adapter)
			cores.set(adapter, core)
			return core(scope)
		},
	}
}

/**
 * One upstream request, retried up to {@link MAX_RETRIES} times on a transient `unavailable` but
 * never after a timeout or spent quota, nor past the deadline; a lane refusal ends it at once.
 */
export const runUpstream = async <T>(
	lane: Lane,
	fn: (signal: AbortSignal) => Promise<T>,
	options: LaneRunOptions & { now: () => number; baseDelayMs?: number }
): Promise<T> => {
	const base = options.baseDelayMs ?? RETRY_BASE_MS
	for (let attempt = 0; ; attempt++) {
		try {
			return await lane.run(fn, options)
		} catch (err) {
			if (isLaneRefused(err) || options.signal.aborted) {
				throw err
			}
			const failure = classifyError(err)
			if (
				failure.kind !== 'unavailable' ||
				failure.timeout ||
				failure.quota ||
				attempt >= MAX_RETRIES
			) {
				throw err
			}
			// Fixed rather than random, so the schedule is testable: 0.5 s, then 1.25 s.
			const delay = base * 2 ** attempt + base * 0.5 * attempt
			if (options.deadline !== undefined && options.now() + delay >= options.deadline) {
				throw err
			}
			try {
				await sleep(delay, options.signal)
			} catch {
				throw err
			}
		}
	}
}
