import { describe, expect, it } from 'vitest'
import { serializeCapabilities } from '../../core/capabilities'
import { rawFilterMap } from '../store/rawRead'
import { DEFAULT_RAW_DAYS, nativeCapabilities } from './capabilities'

const SQLITE_FILTERS = rawFilterMap(['eq', 'contains'])
const POSTGRES_FILTERS = rawFilterMap(['eq', 'contains', 'matches'])

describe('native capabilities', () => {
	it('folds weeks and months itself, cuts visits after 30 idle minutes and sums daily visitors', () => {
		const caps = nativeCapabilities({
			filters: SQLITE_FILTERS,
			rawDays: DEFAULT_RAW_DAYS,
			scoped: false,
			items: false,
		})
		expect(caps).toMatchObject({
			calendarBuckets: true,
			semantics: { visitors: 'sumOfDaily', sessions: 'inactivity30m' },
			filterLookbackDays: 90,
			minGranularity: 'hour',
			maxLookbackDays: null,
			realtime: true,
		})
		expect(caps.perItemQuery).toBeUndefined()
		expect(caps.scopedQueries).toBeUndefined()
		expect([...caps.metrics]).toEqual(
			expect.arrayContaining(['sessions', 'bounceRate', 'visitDuration', 'revenue'])
		)
	})

	it('offers each dimension the operators its store applies, so SQLite offers no matches', () => {
		const sqlite = nativeCapabilities({
			filters: SQLITE_FILTERS,
			rawDays: 90,
			scoped: false,
			items: false,
		})
		const postgres = nativeCapabilities({
			filters: POSTGRES_FILTERS,
			rawDays: 90,
			scoped: false,
			items: false,
		})
		expect(sqlite.filters?.page).toEqual(['eq', 'contains'])
		expect(sqlite.filters?.goal).toEqual(['eq', 'contains'])
		expect(postgres.filters?.page).toEqual(['eq', 'contains', 'matches'])
		expect(Object.values(serializeCapabilities(sqlite).filters).flat()).not.toContain('matches')
	})

	it('offers money, currency and items only on an install that measures them', () => {
		const bare = nativeCapabilities({
			filters: POSTGRES_FILTERS,
			rawDays: null,
			scoped: true,
			revenue: { enabled: false, dimension: false },
			items: false,
		})
		expect(bare.metrics.has('revenue')).toBe(false)
		expect(bare.dimensions.has('currency')).toBe(false)
		expect(bare.filters?.currency).toBeUndefined()
		expect(bare.filters?.item).toBeUndefined()
		expect(bare.filterLookbackDays).toBe(null)
		expect(bare.scopedQueries).toBe(true)
		const full = nativeCapabilities({
			filters: POSTGRES_FILTERS,
			rawDays: 30,
			scoped: false,
			revenue: { enabled: true, dimension: true },
			items: true,
		})
		expect(full.metrics.has('impressions')).toBe(true)
		expect(full.dimensions.has('currency')).toBe(true)
		expect(full.dimensions.has('item')).toBe(true)
		expect(full.filters?.item).toEqual(['eq', 'contains', 'matches'])
		expect(full.perItemQuery).toBe(true)
		const noCurrency = nativeCapabilities({
			filters: POSTGRES_FILTERS,
			rawDays: 30,
			scoped: false,
			revenue: { enabled: true, dimension: false },
			items: false,
		})
		expect(noCurrency.metrics.has('revenue')).toBe(true)
		expect(noCurrency.dimensions.has('currency')).toBe(false)
	})
})
