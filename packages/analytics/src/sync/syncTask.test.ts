import { describe, expect, it } from 'vitest'
import type { AnalyticsRow } from '../core/contract'
import { toSyncRow } from './syncTask'

const now = new Date('2026-06-24T12:00:00.000Z')

describe('toSyncRow', () => {
	it('maps a daily row to a doc: date from timestamp, present metrics, syncedAt', () => {
		const row: AnalyticsRow = {
			timestamp: '2026-06-20T00:00:00.000Z',
			metrics: { pageviews: 12, visitors: 8 },
		}
		expect(toSyncRow('plausible', row, now)).toEqual({
			source: 'plausible',
			date: new Date('2026-06-20T00:00:00.000Z'),
			syncedAt: now,
			pageviews: 12,
			visitors: 8,
		})
	})

	it('omits metrics the row does not report (left null on write)', () => {
		const row: AnalyticsRow = { timestamp: '2026-06-20T00:00:00.000Z', metrics: { pageviews: 3 } }
		const doc = toSyncRow('umami', row, now)
		expect(doc?.pageviews).toBe(3)
		expect(doc && 'visitors' in doc).toBe(false)
		expect(doc && 'bounceRate' in doc).toBe(false)
	})

	it('returns null for a row with a missing or unparseable timestamp', () => {
		expect(toSyncRow('x', { metrics: { pageviews: 1 } }, now)).toBeNull()
		expect(toSyncRow('x', { timestamp: 'not-a-date', metrics: { pageviews: 1 } }, now)).toBeNull()
	})

	it('ignores non-numeric metric values', () => {
		const row = {
			timestamp: '2026-06-20T00:00:00.000Z',
			metrics: { pageviews: 5, visitors: undefined },
		}
		const doc = toSyncRow('x', row as AnalyticsRow, now)
		expect(doc?.pageviews).toBe(5)
		expect(doc && 'visitors' in doc).toBe(false)
	})
})
