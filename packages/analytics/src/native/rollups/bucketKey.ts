import type { RollupKey } from './deltas'

/**
 * A rollup bucket as one string: the coalescing key a flush groups increments by, and the
 * `bucket` column of the seen ledger, so a visitor is counted once per bucket per period.
 * Scope is part of the key only where it is part of the bucket (a scoped install), which
 * keeps an unscoped install's ledger rows byte-identical to what it already wrote.
 */
export function bucketKey(key: RollupKey): string {
	const base = `${key.granularity}|${key.period.toISOString()}|${key.path}|${key.dimension}|${key.dimvalue}|${key.hostname}`
	return key.scope !== undefined ? `${base}|${key.scope}` : base
}
