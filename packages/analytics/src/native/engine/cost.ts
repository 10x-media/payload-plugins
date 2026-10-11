import { MINUTE_MS } from '../../timeframe/tz'
import type { EventStore } from '../store/types'

/**
 * Microseconds a hit adds to counting its day, or to a raw read over it, per store: measured on
 * `tests/load` and rounded up, so a prediction errs long.
 */
export const HIT_COST_US: Readonly<Record<string, number>> = {
	postgres: 30,
	sqlite: 40,
	mongo: 80,
	memory: 2,
}

/** A store of no measured kind costs what the slowest kind does. */
const UNMEASURED_HIT_COST_US = 80

/** Day counts smaller than this say more about a statement's fixed cost than about a hit's. */
export const MIN_OBSERVED_HITS = 5_000

/** The weight of each new observation in the running average. */
const OBSERVED_WEIGHT = 0.25

/** How far observations may move a hit's cost from the measured one, down and up. */
const COST_BOUNDS = { floor: 0.5, ceiling: 20 } as const

/** A store's predicted cost, kept up to date by the counts it runs. */
interface CostModel {
	/** How long reading or counting `hits` is predicted to take on this host, in ms. */
	readMs(hits: number): number
	/** The most hits predicted to fit in `ms`; none for no time at all. */
	hitsReadableIn(ms: number): number
	/** A count of `hits` that took `ms`: past {@link MIN_OBSERVED_HITS}, it moves the prediction. */
	observe(hits: number, ms: number): void
	/** Microseconds a hit is predicted to cost now. */
	perHitUs(): number
}

/**
 * A hit's cost on this host: `HIT_COST_US`, then a running average of the counts run here within
 * half to twenty times it, so a slower host never overruns a read's budget.
 */
export const createCostModel = (store: Pick<EventStore, 'id'>): CostModel => {
	const measured = HIT_COST_US[store.id] ?? UNMEASURED_HIT_COST_US
	let perHit = measured
	return {
		readMs: (hits) => (hits * perHit) / 1000,
		hitsReadableIn: (ms) => (ms > 0 ? Math.floor((ms * 1000) / perHit) : 0),
		observe(hits, ms) {
			if (!Number.isFinite(ms) || ms < 0 || hits < MIN_OBSERVED_HITS) {
				return
			}
			const seen = Math.min(
				measured * COST_BOUNDS.ceiling,
				Math.max(measured * COST_BOUNDS.floor, (ms * 1000) / hits)
			)
			perHit += OBSERVED_WEIGHT * (seen - perHit)
		},
		perHitUs: () => perHit,
	}
}

/**
 * Hits of the day still running above which it is read from its snapshot rather than live: about
 * where one live read of it passes 50 to 100 ms.
 */
const TODAY_SNAPSHOT_ABOVE_HITS: Readonly<Record<string, number>> = {
	postgres: 5_000,
	sqlite: 2_000,
	mongo: 2_000,
	memory: 2_000,
}

const UNMEASURED_SNAPSHOT_ABOVE_HITS = 2_000

export const snapshotAboveHitsOf = (store: Pick<EventStore, 'id'>): number =>
	TODAY_SNAPSHOT_ABOVE_HITS[store.id] ?? UNMEASURED_SNAPSHOT_ABOVE_HITS

/** Up to this many hits a snapshot is served for a minute. */
const SNAPSHOT_MINUTE_HITS = 50_000

/** Where a snapshot's longest age stops rising. */
const SNAPSHOT_LONGEST_HITS = 500_000

/** The longest any snapshot is served: a read ending that long ago may still be answered by one. */
export const SNAPSHOT_LONGEST_AGE_MS = 5 * MINUTE_MS

/** A snapshot is served at least this many times as long as taking it costs. */
const SNAPSHOT_COST_FACTOR = 20

/**
 * How long today's snapshot is served, at most five minutes: a minute up to 50,000 hits, then two
 * rising to five at 500,000, and at least 20 times `costMs` so a slow day is not counted nonstop.
 */
export const snapshotMaxAgeMs = (hits: number, costMs = 0): number => {
	const share = Math.min(
		1,
		Math.max(0, hits - SNAPSHOT_MINUTE_HITS) / (SNAPSHOT_LONGEST_HITS - SNAPSHOT_MINUTE_HITS)
	)
	const byHits =
		hits <= SNAPSHOT_MINUTE_HITS ? MINUTE_MS : Math.round(2 * MINUTE_MS + share * 3 * MINUTE_MS)
	return Math.min(SNAPSHOT_LONGEST_AGE_MS, Math.max(byHits, SNAPSHOT_COST_FACTOR * costMs))
}
