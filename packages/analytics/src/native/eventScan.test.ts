import { describe, expect, it } from 'vitest'
import { EVENT_SCAN_LIMIT, eventScanMeta } from './eventScan'

const fetchedAt = '2026-06-24T12:00:00.000Z'

describe('eventScanMeta', () => {
	it('carries the provider and the fetch time with no flags on a short scan', () => {
		expect(eventScanMeta({ fetchedAt, eventCount: 3, limit: 10 })).toEqual({
			provider: 'native',
			fetchedAt,
		})
	})

	it('marks a scan that filled the cap as sampled', () => {
		expect(eventScanMeta({ fetchedAt, eventCount: 10, limit: 10 }).sampled).toBe(true)
	})

	it('marks a scan past the cap as sampled', () => {
		expect(eventScanMeta({ fetchedAt, eventCount: 11, limit: 10 }).sampled).toBe(true)
	})

	it('falls back to the module cap when no limit is passed', () => {
		expect(eventScanMeta({ fetchedAt, eventCount: EVENT_SCAN_LIMIT }).sampled).toBe(true)
		expect(eventScanMeta({ fetchedAt, eventCount: EVENT_SCAN_LIMIT - 1 }).sampled).toBeUndefined()
	})

	it('carries clamped and sampled together', () => {
		expect(eventScanMeta({ fetchedAt, eventCount: 10, limit: 10, clamped: true })).toEqual({
			provider: 'native',
			fetchedAt,
			clamped: true,
			sampled: true,
		})
	})
})
