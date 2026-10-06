import { describe, expect, it } from 'vitest'
import type { AnalyticsResult } from '../core/contract'
import { readMeta } from './readMeta'

const result = (meta: Partial<AnalyticsResult['meta']> = {}): AnalyticsResult => ({
	rows: [],
	meta: { provider: 'native', fetchedAt: '2026-06-24T12:00:00.000Z', ...meta },
})

describe('readMeta', () => {
	it('answers every flag false on a clean read, naming the provider', () => {
		expect(readMeta(result())).toEqual({
			clamped: false,
			stale: false,
			filtersUnapplied: false,
			goalsUnresolved: false,
			sampled: false,
			provider: 'native',
		})
	})

	it('carries clamped, stale and sampled straight through', () => {
		expect(readMeta(result({ clamped: true, stale: true, sampled: true }))).toMatchObject({
			clamped: true,
			stale: true,
			sampled: true,
		})
	})

	it('reads filtersUnapplied from the dropped filters rather than a flag', () => {
		expect(readMeta(result({ unappliedFilters: [] })).filtersUnapplied).toBe(false)
		expect(
			readMeta(result({ unappliedFilters: [{ dimension: 'page', operator: 'eq', value: '/a' }] }))
				.filtersUnapplied
		).toBe(true)
	})

	it('answers goalsUnresolved only for the flag itself', () => {
		expect(readMeta(result({ goalsUnresolved: true })).goalsUnresolved).toBe(true)
		expect(readMeta(result()).goalsUnresolved).toBe(false)
	})
})
