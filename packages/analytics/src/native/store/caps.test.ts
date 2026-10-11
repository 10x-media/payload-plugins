import { describe, expect, it } from 'vitest'
import { type CappableRow, compareByRank, DEFAULT_CAPS, foldParts, resolveCaps } from './caps'
import { emptyParts, type MetricParts } from './parts'

const parts = (counts: Partial<MetricParts>): MetricParts => ({ ...emptyParts(), ...counts })

const row = (value: string, counts: Partial<MetricParts>, value2 = ''): CappableRow => ({
	hostname: 'a.example',
	value,
	value2,
	parts: parts(counts),
})

const page = (value: string, pageviews: number, events = 0): CappableRow =>
	row(value, {
		pageviews,
		events,
		visitors: pageviews,
		sessions: pageviews,
		entries: 1,
		bounces: 0,
		sessionMs: 1000,
		durationMs: 500,
		scrollSum: 10,
		scrollSamples: 1,
		conversions: 0,
		revenue: 2.5,
		interactions: 0,
	})

describe('cardinality caps', () => {
	it('caps what a beacon picks (pages, currencies) and noisy tails, never items or few-valued kinds', () => {
		expect(DEFAULT_CAPS).toEqual({
			page: 10_000,
			referrer: 500,
			source: 500,
			city: 500,
			region: 300,
			utmSource: 300,
			utmMedium: 300,
			utmCampaign: 300,
			utmContent: 300,
			utmTerm: 300,
			event: 300,
			goalPairs: 300,
			item: null,
			itemPages: 2000,
			language: 200,
			goal: null,
			country: null,
			device: null,
			browser: null,
			os: null,
			channel: null,
			currency: 100,
		})
	})

	it('changes only the kinds named, null lifting a cap', () => {
		expect(resolveCaps(undefined)).toBe(DEFAULT_CAPS)
		expect(resolveCaps({ page: 50, country: 20, item: null, source: undefined })).toEqual({
			...DEFAULT_CAPS,
			page: 50,
			country: 20,
			item: null,
		})
	})

	it('refuses anything but whole counts of at least one, or null, by a kind it knows', () => {
		for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', true]) {
			expect(() => resolveCaps({ page: value }), String(value)).toThrow(/caps\.page/)
		}
		expect(() => resolveCaps({ pages: 10 })).toThrow(/no "pages"; it caps page, referrer/)
		expect(() => resolveCaps([10])).toThrow(/object of caps by kind, got an array/)
		expect(() => resolveCaps('page')).toThrow(/got "page"/)
	})
})

describe('ranking and folding', () => {
	it('ranks by pageviews, then events, then value and second value by code point', () => {
		const rows = [
			page('/b', 3),
			page('/a', 3, 1),
			page('/🎉', 5),
			page('/！', 5),
			page('/c', 3),
			row('/c', { pageviews: 3, events: 0 }, 'x'),
		]
		expect(rows.sort(compareByRank).map((each) => [each.value, each.value2])).toEqual([
			['/！', ''],
			['/🎉', ''],
			['/a', ''],
			['/b', ''],
			['/c', ''],
			['/c', 'x'],
		])
	})

	it('ranks an item, which counts no pageviews, by its views', () => {
		const items = [
			row('offers:1', { impressions: 2, events: 9 }),
			row('offers:2', { impressions: 7, events: 0 }),
		]
		expect(items.sort(compareByRank).map((each) => each.value)).toEqual(['offers:2', 'offers:1'])
	})

	it('folds a tail by summing what adds up and leaving visitors and visits unknown', () => {
		expect(foldParts([page('/a', 2), page('/b', 3)])).toEqual({
			...emptyParts(),
			pageviews: 5,
			events: 0,
			entries: 2,
			bounces: 0,
			durationMs: 1000,
			scrollSum: 20,
			scrollSamples: 2,
			conversions: 0,
			revenue: 5,
			interactions: 0,
		})
	})

	it('folds item rows without inventing the parts an item never counts', () => {
		const items = [
			row('offers:2', { impressions: 2, events: 0, visitors: 2, conversions: 0, revenue: 0 }),
			row('offers:3', { impressions: 1, events: 0, visitors: 1, conversions: 0, revenue: 0 }),
		]
		expect(foldParts(items)).toMatchObject({
			impressions: 3,
			events: 0,
			visitors: null,
			pageviews: null,
			sessions: null,
			entries: null,
		})
	})
})
