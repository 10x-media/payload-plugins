import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../core/contract'
import { mergeAtToday, splitAtToday } from './todaySplit'

const DAY = 86_400_000
const TODAY = 30 * DAY

const query = (extra: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'conversions'],
	dateRange: { start: new Date(20 * DAY), end: new Date(TODAY + 3_600_000) },
	...extra,
})

describe('splitAtToday', () => {
	it('cuts a window of event counts at the start of today', () => {
		const split = splitAtToday(query(), TODAY)
		expect(split?.closed.dateRange).toEqual({ start: new Date(20 * DAY), end: new Date(TODAY - 1) })
		expect(split?.today.dateRange).toEqual({
			start: new Date(TODAY),
			end: new Date(TODAY + 3_600_000),
		})
	})

	it('leaves alone what would not add back up exactly, or has nothing to cut', () => {
		expect(splitAtToday(query({ metrics: ['pageviews', 'visitors'] }), TODAY)).toBeUndefined()
		expect(splitAtToday(query({ metrics: ['bounceRate'] }), TODAY)).toBeUndefined()
		expect(splitAtToday(query({ dimensions: ['page'], limit: 10 }), TODAY)).toBeUndefined()
		expect(splitAtToday(query({ granularity: 'hour' }), TODAY)).toBeUndefined()
		expect(
			splitAtToday(
				query({ dateRange: { start: new Date(TODAY), end: new Date(TODAY + 1) } }),
				TODAY
			)
		).toBeUndefined()
		expect(
			splitAtToday(query({ dateRange: { start: new Date(DAY), end: new Date(TODAY - 1) } }), TODAY)
		).toBeUndefined()
	})
})

describe('mergeAtToday', () => {
	it('adds the counts and carries every caveat of either half', () => {
		const merged = mergeAtToday(
			{
				rows: [{ metrics: { pageviews: 10, conversions: 1 } }],
				totals: { pageviews: 10, conversions: 1 },
				meta: {
					provider: 'native',
					fetchedAt: '2026-01-01T00:00:00.000Z',
					clamped: true,
					dataFrom: '2025-12-01T00:00:00.000Z',
					partial: { missingDays: 1 },
					failed: { days: 2 },
					mixedCurrencies: ['EUR', 'USD'],
				},
			},
			{
				rows: [{ metrics: { pageviews: 3, conversions: 0 } }],
				totals: { pageviews: 3, conversions: 0 },
				meta: {
					provider: 'native',
					fetchedAt: '2026-01-01T00:05:00.000Z',
					asOf: '2026-01-01T00:04:00.000Z',
					capped: { days: 1 },
					mixedCurrencies: ['CHF', 'EUR'],
				},
			},
			query()
		)
		expect(merged.totals).toEqual({ pageviews: 13, conversions: 1 })
		expect(merged.rows).toEqual([{ metrics: { pageviews: 13, conversions: 1 } }])
		expect(merged.meta).toEqual({
			provider: 'native',
			fetchedAt: '2026-01-01T00:00:00.000Z',
			asOf: '2026-01-01T00:04:00.000Z',
			clamped: true,
			dataFrom: '2025-12-01T00:00:00.000Z',
			partial: { missingDays: 1 },
			capped: { days: 1 },
			failed: { days: 2 },
			mixedCurrencies: ['CHF', 'EUR', 'USD'],
		})
	})

	it('adds up the pageviews counted without consent or without a visitor', () => {
		const half = (meta: Partial<Parameters<typeof mergeAtToday>[0]['meta']>) => ({
			rows: [],
			meta: { provider: 'native', fetchedAt: '2026-01-01T00:00:00.000Z', ...meta },
		})
		const merged = mergeAtToday(
			half({ withoutConsent: { pageviews: 4 }, withoutVisitor: { pageviews: 1 } }),
			half({ withoutConsent: { pageviews: 2 }, withoutConsentDropped: true }),
			query()
		)
		expect(merged.meta).toMatchObject({
			withoutConsent: { pageviews: 6 },
			withoutVisitor: { pageviews: 1 },
			withoutConsentDropped: true,
		})
		expect(mergeAtToday(half({}), half({}), query()).meta.withoutConsent).toBeUndefined()
	})
})
