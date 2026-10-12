import type { ReadFailure } from './classifyError'

/** Consecutive `unavailable` failures that open the breaker. */
const BREAKER_THRESHOLD = 5

/** How long a breaker first stays open; each failed probe doubles it. */
export const BREAKER_BASE_MS = 30_000

/** The longest a breaker stays open between probes. */
export const BREAKER_MAX_MS = 600_000

/** How long a run is told to wait while another run is the half-open probe. */
const PROBE_WAIT_MS = 1_000

/**
 * How long a probe may go unanswered before another run may probe: a request that never settles
 * would otherwise keep the breaker half-open, refusing every run, for good.
 */
export const PROBE_EXPIRES_MS = 60_000

export type BreakerState = 'closed' | 'open' | 'half-open'

export interface BreakerSnapshot {
	state: BreakerState
	/** Until the next probe may go, while the breaker refuses. */
	retryAfterMs?: number
	/** The failure that last counted, cleared by a success. */
	lastFailure?: ReadFailure
}

export type Admission = { ok: true; probe: boolean } | { ok: false; retryAfterMs: number }

/**
 * One source's circuit breaker: `peek` claims nothing (should a run queue at all); `admit`, asked
 * once a run holds its slots, may make it the half-open probe. Admitted runs must `record`.
 */
export interface Breaker {
	peek(): Admission
	admit(): Admission
	/** A run's outcome: `success`, or what its failure means; only an admitted run reports. */
	record(outcome: 'success' | ReadFailure, probe: boolean): void
	/** Gives back a probe `admit` claimed for a run that stopped before its request went out. */
	release(): void
	snapshot(): BreakerSnapshot
}

export interface BreakerOptions {
	now: () => number
	threshold?: number
	baseMs?: number
	maxMs?: number
	/** How long a probe may go unanswered before the next run may probe; {@link PROBE_EXPIRES_MS}. */
	probeExpiresMs?: number
}

/** What a failure does: an outage counts, a setup failure opens the breaker, a refusal answers. */
const effectOf = (failure: ReadFailure): 'count' | 'open' | 'answer' => {
	if (failure.kind === 'source_misconfigured') return 'open'
	if (failure.kind === 'unavailable' && !failure.refused) return 'count'
	return 'answer'
}

/**
 * Opens after `threshold` consecutive `unavailable` failures or one `source_misconfigured`, for
 * `baseMs` doubling per failed probe up to `maxMs`; `invalid_param` still answered, so it succeeds.
 */
export const createBreaker = (options: BreakerOptions): Breaker => {
	const threshold = options.threshold ?? BREAKER_THRESHOLD
	const baseMs = options.baseMs ?? BREAKER_BASE_MS
	const maxMs = options.maxMs ?? BREAKER_MAX_MS
	const probeExpiresMs = options.probeExpiresMs ?? PROBE_EXPIRES_MS
	let state: BreakerState = 'closed'
	let consecutive = 0
	let periodMs = baseMs
	let openUntil = 0
	let probing = false
	let probedAt = 0
	let lastFailure: ReadFailure | undefined

	const open = (at: number): void => {
		state = 'open'
		openUntil = at + periodMs
		probing = false
	}

	const decide = (claim: boolean): Admission => {
		if (state === 'closed') {
			return { ok: true, probe: false }
		}
		const at = options.now()
		if (state === 'open' && at < openUntil) {
			return { ok: false, retryAfterMs: openUntil - at }
		}
		if (probing && at - probedAt < probeExpiresMs) {
			return { ok: false, retryAfterMs: Math.min(PROBE_WAIT_MS, probeExpiresMs - (at - probedAt)) }
		}
		if (claim) {
			state = 'half-open'
			probing = true
			probedAt = at
		}
		return { ok: true, probe: true }
	}

	return {
		peek: () => decide(false),
		admit: () => decide(true),
		release() {
			if (probing) {
				probing = false
				state = 'open'
			}
		},
		record(outcome, probe) {
			const effect = outcome === 'success' ? 'answer' : effectOf(outcome)
			if (outcome === 'success' || effect === 'answer') {
				consecutive = 0
				lastFailure = undefined
				if (probe || state !== 'closed') {
					state = 'closed'
					periodMs = baseMs
					probing = false
				}
				return
			}
			lastFailure = outcome
			const at = options.now()
			if (probe) {
				periodMs = Math.min(periodMs * 2, maxMs)
				open(at)
				return
			}
			if (state !== 'closed') {
				return
			}
			consecutive++
			if (effect === 'open' || consecutive >= threshold) {
				consecutive = 0
				open(at)
			}
		},
		snapshot() {
			const at = options.now()
			const waiting = state === 'open' && at < openUntil
			return {
				state,
				...(waiting ? { retryAfterMs: openUntil - at } : {}),
				...(lastFailure ? { lastFailure } : {}),
			}
		},
	}
}
