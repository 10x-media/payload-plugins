import { describe, expect, it } from 'vitest'
import { resolveTimeframe, TIMEFRAME_PRESETS } from './presets'

const now = new Date('2026-06-17T14:30:00.000Z')

describe('resolveTimeframe', () => {
	it('today starts at UTC midnight and ends at now', () => {
		const { start, end } = resolveTimeframe('today', now)
		expect(start.toISOString()).toBe('2026-06-17T00:00:00.000Z')
		expect(end.toISOString()).toBe('2026-06-17T14:30:00.000Z')
	})

	it('last7days spans 7 inclusive UTC days', () => {
		const { start, end } = resolveTimeframe('last7days', now)
		expect(start.toISOString()).toBe('2026-06-11T00:00:00.000Z')
		expect(end.toISOString()).toBe('2026-06-17T14:30:00.000Z')
	})

	it('last30days spans 30 inclusive UTC days', () => {
		const { start } = resolveTimeframe('last30days', now)
		expect(start.toISOString()).toBe('2026-05-19T00:00:00.000Z')
	})

	it('last90days spans 90 inclusive UTC days', () => {
		const { start } = resolveTimeframe('last90days', now)
		expect(start.toISOString()).toBe('2026-03-20T00:00:00.000Z')
	})

	it('thisMonth starts on the first of the month UTC', () => {
		const { start } = resolveTimeframe('thisMonth', now)
		expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
	})

	it('thisYear starts on Jan 1 UTC', () => {
		const { start } = resolveTimeframe('thisYear', now)
		expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
	})

	it('exposes the preset list', () => {
		expect(TIMEFRAME_PRESETS).toContain('last30days')
		expect(TIMEFRAME_PRESETS).toHaveLength(6)
	})
})
