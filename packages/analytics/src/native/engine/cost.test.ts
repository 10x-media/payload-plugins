import { describe, expect, it } from 'vitest'
import {
	createCostModel,
	HIT_COST_US,
	MIN_OBSERVED_HITS,
	SNAPSHOT_LONGEST_AGE_MS,
	snapshotAboveHitsOf,
	snapshotMaxAgeMs,
} from './cost'

const MINUTE = 60_000
const postgres = { id: 'postgres' }
const sqlite = { id: 'sqlite' }
const mongo = { id: 'mongo' }

/** What a store is predicted to cost before any count moved its model. */
const measured = (store: { id: string }) => createCostModel(store)

describe('predicted cost', () => {
	it('prices a hit by the store that reads it, an unmeasured store as the slowest', () => {
		expect(HIT_COST_US).toEqual({ postgres: 30, sqlite: 40, mongo: 80, memory: 2 })
		expect(measured(postgres).readMs(20_000)).toBe(600)
		expect(measured(sqlite).readMs(20_000)).toBe(800)
		expect(measured(mongo).readMs(20_000)).toBe(1_600)
		expect(measured({ id: 'd1' }).readMs(1_000)).toBe(80)
	})

	it('fits as many hits in a budget as their cost allows, none in no time', () => {
		expect(measured(postgres).hitsReadableIn(3_000)).toBe(100_000)
		expect(measured(sqlite).hitsReadableIn(3_000)).toBe(75_000)
		expect(measured(mongo).hitsReadableIn(3_000)).toBe(37_500)
		expect(measured(postgres).hitsReadableIn(0)).toBe(0)
		expect(measured(postgres).hitsReadableIn(-5)).toBe(0)
		const model = measured(mongo)
		expect(model.readMs(model.hitsReadableIn(3_000))).toBeLessThanOrEqual(3_000)
	})
})

describe('a cost model kept by observed counts', () => {
	it('starts at the measured cost', () => {
		expect(measured(postgres).perHitUs()).toBe(30)
	})

	it('moves toward what counts on this host took, a quarter at a time', () => {
		const model = createCostModel(postgres)
		model.observe(100_000, 9_000)
		expect(model.perHitUs()).toBe(30 + 0.25 * (90 - 30))
		for (let run = 0; run < 40; run++) {
			model.observe(100_000, 9_000)
		}
		expect(model.perHitUs()).toBeCloseTo(90, 3)
		expect(model.readMs(100_000)).toBeCloseTo(9_000, 0)
	})

	it('stays within half to twenty times the measured cost, and ignores small or broken counts', () => {
		const slow = createCostModel(sqlite)
		for (let run = 0; run < 60; run++) {
			slow.observe(MIN_OBSERVED_HITS, 1_000_000)
		}
		expect(slow.perHitUs()).toBeCloseTo(40 * 20, 3)
		const fast = createCostModel(sqlite)
		for (let run = 0; run < 60; run++) {
			fast.observe(1_000_000, 0)
		}
		expect(fast.perHitUs()).toBeCloseTo(20, 3)
		const untouched = createCostModel(mongo)
		untouched.observe(MIN_OBSERVED_HITS - 1, 1_000_000)
		untouched.observe(1_000_000, Number.NaN)
		untouched.observe(1_000_000, -1)
		expect(untouched.perHitUs()).toBe(80)
	})
})

describe("today's snapshot", () => {
	it('reads today live up to 5,000 hits on Postgres and 2,000 elsewhere', () => {
		expect(snapshotAboveHitsOf(postgres)).toBe(5_000)
		expect(snapshotAboveHitsOf(sqlite)).toBe(2_000)
		expect(snapshotAboveHitsOf(mongo)).toBe(2_000)
		expect(snapshotAboveHitsOf({ id: 'd1' })).toBe(2_000)
	})

	it('serves a snapshot a minute up to 50,000 hits, then two minutes rising to five', () => {
		expect(snapshotMaxAgeMs(0)).toBe(MINUTE)
		expect(snapshotMaxAgeMs(50_000)).toBe(MINUTE)
		expect(snapshotMaxAgeMs(50_001)).toBe(2 * MINUTE)
		expect(snapshotMaxAgeMs(275_000)).toBe(3.5 * MINUTE)
		expect(snapshotMaxAgeMs(500_000)).toBe(5 * MINUTE)
		expect(snapshotMaxAgeMs(5_000_000)).toBe(5 * MINUTE)
		expect(SNAPSHOT_LONGEST_AGE_MS).toBe(5 * MINUTE)
	})

	it('serves a snapshot that is slow to take at least twenty times as long, five minutes at most', () => {
		expect(snapshotMaxAgeMs(20_000, 8_600)).toBe(172_000)
		const cost = measured(mongo)
		expect(snapshotMaxAgeMs(20_000, cost.readMs(20_000))).toBe(MINUTE)
		expect(snapshotMaxAgeMs(100_000, cost.readMs(100_000))).toBe(160_000)
		expect(snapshotMaxAgeMs(200_000, cost.readMs(200_000))).toBe(5 * MINUTE)
	})
})
