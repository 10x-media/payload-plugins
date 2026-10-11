import { describe, expect, it } from 'vitest'
import type { WireSource } from './fetchSources'
import { narrowMetricOptions, satisfiesSerialized } from './narrow'

const source = (
	id: string,
	metrics: string[],
	extra: Partial<WireSource['capabilities']> = {}
): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities: {
		realtime: false,
		comparison: false,
		minGranularity: 'day',
		maxLookbackDays: null,
		metrics: metrics as WireSource['capabilities']['metrics'],
		dimensions: [],
		filters: {},
		...extra,
	},
})

const options = [
	{ value: 'pageviews', label: 'Pageviews' },
	{ value: 'visitors', label: 'Visitors' },
	{ value: 'bounceRate', label: 'Bounce rate' },
]

describe('narrowMetricOptions', () => {
	it("filters options to the selected source's metrics", () => {
		const out = narrowMetricOptions({
			options,
			sources: [source('posthog:a', ['pageviews', 'visitors'])],
			sourceId: 'posthog:a',
		})
		expect(out.map((o) => o.value)).toEqual(['pageviews', 'visitors'])
	})

	it('keeps the full list for an unknown or stale source id', () => {
		const out = narrowMetricOptions({
			options,
			sources: [source('x', ['pageviews'])],
			sourceId: 'gone',
		})
		expect(out).toEqual(options)
	})

	it('keeps the full list when no source is selected', () => {
		expect(narrowMetricOptions({ options, sources: [], sourceId: undefined })).toEqual(options)
	})

	it('applies extra requirements (a breakdown dimension) on top of the metric', () => {
		const src = source('umami:b', ['pageviews', 'visitors'], { dimensions: ['page'] as never })
		const out = narrowMetricOptions({
			options,
			sources: [src],
			sourceId: 'umami:b',
			requires: { dimensions: ['country'] },
		})
		expect(out).toEqual(options) // requirement unmet by the source: fall back to the full list
	})

	it('narrows when extra requirements are met', () => {
		const src = source('umami:b', ['pageviews'], { dimensions: ['country'] as never })
		const out = narrowMetricOptions({
			options,
			sources: [src],
			sourceId: 'umami:b',
			requires: { dimensions: ['country'] },
		})
		expect(out.map((o) => o.value)).toEqual(['pageviews'])
	})
})

describe('satisfiesSerialized', () => {
	const caps = source('x', ['pageviews']).capabilities

	it('fails a filters requirement the source cannot serve', () => {
		expect(satisfiesSerialized(caps, { filters: ['country'] })).toBe(false)
	})

	it('passes a filters requirement the source can serve', () => {
		const withFilters = { ...caps, filters: { country: ['eq' as const] } }
		expect(satisfiesSerialized(withFilters, { filters: ['country'] })).toBe(true)
	})

	it('fails a pair whose operator the source does not take for that dimension', () => {
		const withFilters = { ...caps, filters: { country: ['eq' as const] } }
		expect(
			satisfiesSerialized(withFilters, {
				filters: [{ dimension: 'country', operator: 'contains' }],
			})
		).toBe(false)
	})

	it('passes a pair the source takes', () => {
		const withFilters = { ...caps, filters: { country: ['eq' as const] } }
		expect(
			satisfiesSerialized(withFilters, { filters: [{ dimension: 'country', operator: 'eq' }] })
		).toBe(true)
	})
})
