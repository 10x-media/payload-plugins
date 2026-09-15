import { describe, expect, it } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import { gate } from './gating'
import {
	coerceState,
	DEFAULT_VIEW_LIMIT,
	parseViewState,
	rangeFor,
	serializeViewState,
	type ViewDefaults,
	type ViewState,
} from './state'

const defaults: ViewDefaults = { range: 'last30days', metric: 'pageviews' }

const parse = (search: string, override?: ViewDefaults): ViewState =>
	parseViewState(new URLSearchParams(search), override ?? defaults)

const baseState: ViewState = {
	range: 'last30days',
	compare: false,
	metric: 'pageviews',
	tab: 'pages',
	filters: [],
	limit: DEFAULT_VIEW_LIMIT,
}

describe('parseViewState', () => {
	it('answers the defaults for an empty search', () => {
		expect(parse('')).toEqual(baseState)
	})

	it('honors the install defaults', () => {
		expect(parse('', { range: 'today', metric: 'visitors' })).toEqual({
			...baseState,
			range: 'today',
			metric: 'visitors',
		})
	})

	it('reads every parameter', () => {
		const state = parse(
			'range=last7days&compare=1&source=native&metric=visitors&granularity=hour&tab=geography&limit=25&order=visitors:asc&filters=' +
				encodeURIComponent('[{"dimension":"country","operator":"eq","value":"DE"}]')
		)
		expect(state).toEqual({
			range: 'last7days',
			compare: true,
			source: 'native',
			metric: 'visitors',
			granularity: 'hour',
			tab: 'geography',
			limit: 25,
			order: { metric: 'visitors', direction: 'asc' },
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		})
	})

	it('falls back to the defaults for invalid values', () => {
		expect(
			parse('range=fortnight&metric=clicks&tab=funnels&limit=7&granularity=decade&order=nope')
		).toEqual(baseState)
	})

	it('rejects the unbounded allTime preset, which the endpoint cannot serve', () => {
		expect(parse('range=allTime').range).toBe('last30days')
		expect(parse('', { range: 'allTime', metric: 'pageviews' }).range).toBe('last30days')
	})

	it('keeps a custom range and drops from/to on a preset range', () => {
		expect(parse('range=custom&from=2026-01-01&to=2026-01-31')).toEqual({
			...baseState,
			range: 'custom',
			from: '2026-01-01',
			to: '2026-01-31',
		})
		const preset = parse('range=last7days&from=2026-01-01&to=2026-01-31')
		expect(preset.from).toBeUndefined()
		expect(preset.to).toBeUndefined()
	})

	it('falls back when a custom range is incomplete, malformed, reversed or too long', () => {
		expect(parse('range=custom').range).toBe('last30days')
		expect(parse('range=custom&from=2026-02-30&to=2026-03-01').range).toBe('last30days')
		expect(parse('range=custom&from=yesterday&to=today').range).toBe('last30days')
		expect(parse('range=custom&from=2026-03-01&to=2026-01-01').range).toBe('last30days')
		expect(parse('range=custom&from=2025-01-01&to=2026-12-31').range).toBe('last30days')
		expect(parse('range=custom&from=2026-01-01&to=2026-12-31').range).toBe('custom')
	})

	it('drops filters the contract does not define and survives malformed JSON', () => {
		const filters = (search: string) => parse(search).filters
		const json = (value: unknown) => `filters=${encodeURIComponent(JSON.stringify(value))}`
		expect(filters(json([{ dimension: 'tenant', operator: 'eq', value: 'a' }]))).toEqual([])
		expect(filters(json([{ dimension: 'page', operator: 'startsWith', value: 'a' }]))).toEqual([])
		expect(filters(json([{ dimension: 'page', operator: 'eq', value: 7 }]))).toEqual([])
		expect(filters(json([{ dimension: 'page', operator: 'eq', value: '  ' }]))).toEqual([])
		expect(filters(json(['page']))).toEqual([])
		expect(filters(json({ dimension: 'page' }))).toEqual([])
		expect(filters('filters=not-json')).toEqual([])
		expect(filters(json([{ dimension: 'page', operator: 'eq', value: ' /docs ' }]))).toEqual([
			{ dimension: 'page', operator: 'eq', value: '/docs' },
		])
	})

	it('keeps only the first ten filters', () => {
		const many = Array.from({ length: 12 }, (_, i) => ({
			dimension: 'page',
			operator: 'eq',
			value: `/p/${i}`,
		}))
		expect(parse(`filters=${encodeURIComponent(JSON.stringify(many))}`).filters).toHaveLength(10)
	})

	it('drops an order whose direction is not asc or desc', () => {
		expect(parse('order=visitors:sideways').order).toBeUndefined()
		expect(parse('order=visitors').order).toBeUndefined()
	})
})

describe('serializeViewState', () => {
	it('omits every value equal to a default', () => {
		expect(serializeViewState(baseState, defaults).toString()).toBe('')
		expect(
			serializeViewState(
				{ ...baseState, range: 'today', metric: 'visitors' },
				{
					range: 'today',
					metric: 'visitors',
				}
			).toString()
		).toBe('')
	})

	it('emits a stable key order', () => {
		const params = serializeViewState(
			{
				range: 'custom',
				from: '2026-01-01',
				to: '2026-01-31',
				compare: true,
				source: 'native',
				metric: 'visitors',
				granularity: 'day',
				tab: 'sources',
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
				limit: 50,
				order: { metric: 'visitors', direction: 'asc' },
			},
			defaults
		)
		expect([...params.keys()]).toEqual([
			'range',
			'from',
			'to',
			'compare',
			'source',
			'metric',
			'granularity',
			'tab',
			'filters',
			'limit',
			'order',
		])
	})

	it('round trips every state it emits', () => {
		const states: ViewState[] = [
			baseState,
			{ ...baseState, range: 'custom', from: '2026-01-01', to: '2026-01-31' },
			{ ...baseState, compare: true, source: 'posthog', granularity: 'hour' },
			{
				...baseState,
				metric: 'conversions',
				tab: 'goals',
				limit: 100,
				order: { metric: 'conversions', direction: 'desc' },
				filters: [
					{ dimension: 'page', operator: 'contains', value: '/docs' },
					{ dimension: 'country', operator: 'eq', value: 'DE' },
				],
			},
		]
		for (const state of states) {
			expect(parseViewState(serializeViewState(state, defaults), defaults)).toEqual(state)
		}
	})
})

const caps = (over: Partial<SerializedCapabilities> = {}): SerializedCapabilities => ({
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page', 'country'],
	filters: ['page'],
	filterOperators: ['eq'],
	realtime: false,
	perPageQuery: true,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	...over,
})

describe('coerceState', () => {
	it('returns the same object when the gate forbids nothing', () => {
		const state: ViewState = { ...baseState, filters: [] }
		expect(coerceState(state, gate(caps()))).toBe(state)
	})

	it('falls back to the first served metric and tab', () => {
		const coerced = coerceState(
			{ ...baseState, metric: 'revenue', tab: 'events' },
			gate(caps({ metrics: ['visitors', 'pageviews'] }))
		)
		expect(coerced.metric).toBe('pageviews')
		expect(coerced.tab).toBe('pages')
	})

	it('drops filters the source cannot apply and operators it does not support', () => {
		const coerced = coerceState(
			{
				...baseState,
				filters: [
					{ dimension: 'page', operator: 'eq', value: '/a' },
					{ dimension: 'country', operator: 'eq', value: 'DE' },
					{ dimension: 'page', operator: 'contains', value: 'docs' },
				],
			},
			gate(caps())
		)
		expect(coerced.filters).toEqual([{ dimension: 'page', operator: 'eq', value: '/a' }])
	})

	it('drops a comparison, a granularity and an order the source cannot serve', () => {
		const coerced = coerceState(
			{
				...baseState,
				compare: true,
				granularity: 'hour',
				order: { metric: 'revenue', direction: 'desc' },
			},
			gate(caps())
		)
		expect(coerced.compare).toBe(false)
		expect(coerced.granularity).toBeUndefined()
		expect(coerced.order).toBeUndefined()
	})

	it('keeps a granularity the source serves', () => {
		const coerced = coerceState(
			{ ...baseState, granularity: 'hour', compare: true },
			gate(caps({ minGranularity: 'hour', comparison: true }))
		)
		expect(coerced.granularity).toBe('hour')
		expect(coerced.compare).toBe(true)
	})
})

describe('rangeFor', () => {
	// 01:30 on March 1 in Berlin, 19:30 on February 28 in New York.
	const now = new Date('2026-03-01T00:30:00.000Z')
	const at = (range: ViewState['range'], from?: string, to?: string): ViewState => ({
		...baseState,
		range,
		...(from === undefined ? {} : { from }),
		...(to === undefined ? {} : { to }),
	})

	it('resolves today in the reporting timezone', () => {
		expect(rangeFor(at('today'), 'Europe/Berlin', now)).toEqual({
			from: '2026-03-01',
			to: '2026-03-01',
		})
		expect(rangeFor(at('today'), 'America/New_York', now)).toEqual({
			from: '2026-02-28',
			to: '2026-02-28',
		})
	})

	it('counts inclusive day windows across a month boundary', () => {
		expect(rangeFor(at('last7days'), 'Europe/Berlin', now)).toEqual({
			from: '2026-02-23',
			to: '2026-03-01',
		})
		expect(rangeFor(at('last30days'), 'Europe/Berlin', now)).toEqual({
			from: '2026-01-31',
			to: '2026-03-01',
		})
		expect(rangeFor(at('last30days'), 'America/New_York', now)).toEqual({
			from: '2026-01-30',
			to: '2026-02-28',
		})
		expect(rangeFor(at('last90days'), 'Europe/Berlin', now)).toEqual({
			from: '2025-12-02',
			to: '2026-03-01',
		})
	})

	it('resolves the twelve month preset to 365 inclusive days', () => {
		expect(rangeFor(at('lastYear'), 'Europe/Berlin', now)).toEqual({
			from: '2025-03-02',
			to: '2026-03-01',
		})
		expect(rangeFor(at('lastYear'), 'America/New_York', now)).toEqual({
			from: '2025-03-01',
			to: '2026-02-28',
		})
	})

	it('resolves calendar presets in the reporting timezone', () => {
		expect(rangeFor(at('thisMonth'), 'Europe/Berlin', now)).toEqual({
			from: '2026-03-01',
			to: '2026-03-01',
		})
		expect(rangeFor(at('thisMonth'), 'America/New_York', now)).toEqual({
			from: '2026-02-01',
			to: '2026-02-28',
		})
		expect(rangeFor(at('thisYear'), 'Europe/Berlin', now)).toEqual({
			from: '2026-01-01',
			to: '2026-03-01',
		})
		expect(rangeFor(at('thisYear'), 'America/New_York', now)).toEqual({
			from: '2026-01-01',
			to: '2026-02-28',
		})
	})

	it('counts whole days across both Berlin DST transitions', () => {
		// Berlin springs forward on 2026-03-29 and falls back on 2026-10-25; a 23 or 25 hour
		// day must not shift the window by one.
		const autumn = new Date('2026-11-01T12:00:00.000Z')
		expect(rangeFor(at('lastYear'), 'Europe/Berlin', autumn)).toEqual({
			from: '2025-11-02',
			to: '2026-11-01',
		})
		expect(rangeFor(at('last90days'), 'Europe/Berlin', autumn)).toEqual({
			from: '2026-08-04',
			to: '2026-11-01',
		})
		const spring = new Date('2026-03-30T12:00:00.000Z')
		expect(rangeFor(at('last7days'), 'Europe/Berlin', spring)).toEqual({
			from: '2026-03-24',
			to: '2026-03-30',
		})
	})

	it('passes a custom range through untouched', () => {
		expect(rangeFor(at('custom', '2026-01-01', '2026-01-31'), 'Europe/Berlin', now)).toEqual({
			from: '2026-01-01',
			to: '2026-01-31',
		})
	})
})
