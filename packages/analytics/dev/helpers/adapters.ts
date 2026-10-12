import { setTimeout as sleep } from 'node:timers/promises'
import { type AnalyticsAdapter, memoryAdapter } from '@10x-media/analytics/testing'

/**
 * A second, in-memory source, one instance shared by the config and the seed so seeded events land
 * where reads look. It keeps the multi-source surfaces in view: the data-source select, per-source
 * metrics, and sync, which persists vendor sources only and so needs one to write any rows.
 */
export const devMemoryAdapter = memoryAdapter()

/**
 * `adapter` with every read answered only after `delayMs`, standing in for a vendor whose upstream
 * is slow, for the e2e check that no admin screen waits on a source before it paints.
 */
export const delayedAdapter = (adapter: AnalyticsAdapter, delayMs: number): AnalyticsAdapter => ({
	...adapter,
	query: async (query, ctx) => {
		await sleep(delayMs, undefined, ctx.signal ? { signal: ctx.signal } : {})
		return adapter.query(query, ctx)
	},
})
