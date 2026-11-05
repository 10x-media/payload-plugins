import { describe, expect, it } from 'vitest'
import type { AnalyticsResult } from '../core/contract'
import { mergeNotices, readMeta } from './readMeta'

const result = (meta: Partial<AnalyticsResult['meta']> = {}): AnalyticsResult => ({
	rows: [],
	meta: { provider: 'native', fetchedAt: '2026-06-24T12:00:00.000Z', ...meta },
})

describe('readMeta', () => {
	it('answers every flag false on a clean read, naming the provider', () => {
		expect(readMeta(result())).toEqual({
			clamped: false,
			stale: false,
			sourceError: false,
			hostRefused: false,
			filtersUnapplied: false,
			goalsUnresolved: false,
			sampled: false,
			partial: false,
			capped: false,
			failed: false,
			timezoneUnresolved: false,
			visitorsSummed: false,
			withoutConsentDropped: false,
			mixedCurrencies: [],
			provider: 'native',
		})
	})

	it('carries days given up and the bounds a clamped read kept', () => {
		expect(
			readMeta(
				result({
					failed: { days: 2 },
					clamped: true,
					dataFrom: '2026-07-12T00:00:00.000Z',
					dataTo: '2026-10-08T00:00:00.000Z',
				})
			)
		).toMatchObject({
			failed: true,
			clamped: true,
			dataFrom: '2026-07-12T00:00:00.000Z',
			dataTo: '2026-10-08T00:00:00.000Z',
		})
		expect(readMeta(result({ dataFrom: '2026-07-12T00:00:00.000Z' })).dataFrom).toBeUndefined()
		expect(
			mergeNotices(
				{ clamped: true, dataFrom: '2026-07-01T00:00:00.000Z', dataTo: '2026-10-08T00:00:00.000Z' },
				{ clamped: true, dataFrom: '2026-07-12T00:00:00.000Z', dataTo: '2026-10-05T00:00:00.000Z' }
			)
		).toMatchObject({ dataFrom: '2026-07-12T00:00:00.000Z', dataTo: '2026-10-05T00:00:00.000Z' })
	})

	it('says when visitors add up each day of the range rather than counting each person once', () => {
		expect(readMeta(result({ visitorsAre: 'sumOfDaily' })).visitorsSummed).toBe(true)
		expect(readMeta(result({ visitorsAre: 'distinct' })).visitorsSummed).toBe(false)
		expect(mergeNotices({ visitorsSummed: false }, { visitorsSummed: true }).visitorsSummed).toBe(
			true
		)
	})

	it('says the vendor drops what is counted without consent when any read says so', () => {
		expect(readMeta(result({ withoutConsentDropped: true })).withoutConsentDropped).toBe(true)
		expect(readMeta(result()).withoutConsentDropped).toBe(false)
		expect(
			mergeNotices({ withoutConsentDropped: false }, { withoutConsentDropped: true })
				.withoutConsentDropped
		).toBe(true)
	})

	it('keeps the range’s pageviews without a visitor once, however many reads carry them', () => {
		expect(readMeta(result({ withoutVisitor: { pageviews: 1204 } })).withoutVisitor).toBe(1204)
		expect(readMeta(result()).withoutVisitor).toBeUndefined()
		expect(mergeNotices({ withoutVisitor: 1204 }, { withoutVisitor: 300 }, {}).withoutVisitor).toBe(
			1204
		)
		expect(mergeNotices({}, undefined).withoutVisitor).toBeUndefined()
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

	it('says a stale read needs its source checked, and when the host is the reason', () => {
		expect(readMeta(result({ stale: true, sourceError: 'misconfigured' }))).toMatchObject({
			sourceError: true,
			hostRefused: false,
		})
		expect(readMeta(result({ stale: true, sourceError: 'host-refused' }))).toMatchObject({
			sourceError: true,
			hostRefused: true,
		})
	})

	it('carries the currency the source said its revenue is in', () => {
		expect(readMeta(result({ currency: 'EUR' })).currency).toBe('EUR')
		expect(readMeta(result()).currency).toBeUndefined()
	})

	it('answers goalsUnresolved only for the flag itself', () => {
		expect(readMeta(result({ goalsUnresolved: true })).goalsUnresolved).toBe(true)
		expect(readMeta(result()).goalsUnresolved).toBe(false)
	})

	it('maps uncounted days, grouped values, an unresolved zone, currencies and a snapshot', () => {
		expect(
			readMeta(
				result({
					partial: { missingDays: 3 },
					capped: { days: 2 },
					timezoneUnresolved: true,
					mixedCurrencies: ['EUR', 'USD'],
					asOf: '2026-06-24T11:58:00.000Z',
				})
			)
		).toMatchObject({
			partial: true,
			capped: true,
			timezoneUnresolved: true,
			mixedCurrencies: ['EUR', 'USD'],
			asOf: '2026-06-24T11:58:00.000Z',
		})
		expect(
			readMeta(result({ partial: { missingDays: 0 }, mixedCurrencies: ['EUR'] }))
		).toMatchObject({ partial: false, mixedCurrencies: [] })
	})
})

describe('mergeNotices', () => {
	it('raises a flag any read raises, unions the currencies and keeps the oldest snapshot', () => {
		expect(
			mergeNotices(
				{ partial: true, mixedCurrencies: ['USD', 'EUR'], asOf: '2026-06-24T11:59:00.000Z' },
				undefined,
				{ capped: true, mixedCurrencies: ['GBP', 'EUR'], asOf: '2026-06-24T11:55:00.000Z' }
			)
		).toEqual({
			clamped: false,
			stale: false,
			sourceError: false,
			hostRefused: false,
			filtersUnapplied: false,
			goalsUnresolved: false,
			sampled: false,
			partial: true,
			capped: true,
			failed: false,
			timezoneUnresolved: false,
			visitorsSummed: false,
			withoutConsentDropped: false,
			mixedCurrencies: ['EUR', 'GBP', 'USD'],
			asOf: '2026-06-24T11:55:00.000Z',
		})
	})

	it('keeps the first currency any read names, and a source error any read raises', () => {
		expect(
			mergeNotices({ sourceError: true }, { currency: 'USD' }, { currency: 'EUR' })
		).toMatchObject({ sourceError: true, hostRefused: false, currency: 'USD' })
	})

	it('answers a clean set for no reads at all', () => {
		expect(mergeNotices(undefined)).toMatchObject({ partial: false, mixedCurrencies: [] })
		expect(mergeNotices().asOf).toBeUndefined()
	})
})
