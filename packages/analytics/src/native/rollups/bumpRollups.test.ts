import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { bumpRollups, type RollupBump } from './bumpRollups'
import type { RollupKey } from './deltas'

const key = (over: Partial<RollupKey> = {}): RollupKey => ({
	granularity: 'day',
	period: new Date('2026-03-01T00:00:00Z'),
	path: '/a',
	dimension: '',
	dimvalue: '',
	hostname: '',
	...over,
})

type ConflictSpy = ReturnType<typeof conflictSpy>

const conflictSpy = () =>
	vi.fn<(conflict: { target: unknown[] }) => Promise<unknown>>(async () => {})

const targetOf = (spy: ConflictSpy): unknown[] => spy.mock.calls[0]?.[0].target ?? []

const pgPayload = (
	onConflictDoUpdate: ConflictSpy
): { payload: Payload; columns: Record<string, { name: string }> } => {
	const columns = Object.fromEntries(
		[
			'granularity',
			'period',
			'path',
			'dimension',
			'dimvalue',
			'hostname',
			'scope',
			'pageviews',
			'events',
			'durationMs',
			'samples',
			'visitors',
			'sessions',
			'conversions',
			'revenue',
			'scrollDepthSum',
			'scrollSamples',
		].map((name) => [name, { name }])
	)
	return {
		columns,
		payload: {
			db: {
				name: 'postgres',
				drizzle: { insert: () => ({ values: () => ({ onConflictDoUpdate }) }) },
				tables: { analytics_rollups: columns },
				tableNameMap: new Map([['analytics_rollups', 'analytics_rollups']]),
			},
		} as unknown as Payload,
	}
}

const bump = (over: Partial<RollupKey> = {}): RollupBump => ({
	key: key(over),
	inc: { pageviews: 1 },
})

describe('bumpRollups on postgres', () => {
	it('adds the scope column to the conflict target only for a scoped batch', async () => {
		const scopedConflict = conflictSpy()
		const scoped = pgPayload(scopedConflict)
		await bumpRollups(scoped.payload, [bump({ scope: 't1' }), bump({ path: '/b', scope: 't2' })])
		expect(targetOf(scopedConflict)).toContain(scoped.columns.scope)

		const bareConflict = conflictSpy()
		const bare = pgPayload(bareConflict)
		await bumpRollups(bare.payload, [bump(), bump({ path: '/b' })])
		expect(targetOf(bareConflict)).not.toContain(bare.columns.scope)
	})

	it('refuses a batch that mixes scoped and unscoped buckets', async () => {
		const conflict = conflictSpy()
		const { payload } = pgPayload(conflict)
		await expect(
			bumpRollups(payload, [bump({ scope: 't1' }), bump({ path: '/b' })])
		).rejects.toThrow(/mix scoped and unscoped/)
		await expect(
			bumpRollups(payload, [bump({ path: '/b' }), bump({ scope: 't1' })])
		).rejects.toThrow(/mix scoped and unscoped/)
		expect(conflict).not.toHaveBeenCalled()
	})
})
