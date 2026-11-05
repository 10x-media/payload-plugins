import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities } from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { forecastVisitorsTitle } from './titleForecast'

const NOW = new Date('2026-10-15T12:00:00.000Z')

const source = (id: string, over: Partial<AnalyticsCapabilities>): AnalyticsAdapter => ({
	...memoryAdapter(),
	id,
	capabilities: { ...memoryAdapter().capabilities, ...over },
})

const daily = source('native', {
	semantics: { visitors: 'sumOfDaily', sessions: 'inactivity30m' },
	calendarBuckets: true,
})
const vendor = source('ga4', { semantics: { visitors: 'distinct', sessions: 'provider' } })

const requestWith = (adapters: AnalyticsAdapter[], over: Partial<AnalyticsRuntime> = {}) => {
	const payload = {} as Payload
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((adapter) => adapter.id)),
		bindings: {},
		readAccess: () => true,
		engine: { read: (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: false,
		...over,
	})
	return { payload } as PayloadRequest
}

const forecast = (
	req: PayloadRequest,
	over: Partial<Parameters<typeof forecastVisitorsTitle>[0]> = {}
) => forecastVisitorsTitle({ req, metric: 'visitors', timeframe: 'last30days', now: NOW, ...over })

describe('forecastVisitorsTitle', () => {
	it('forecasts summed daily visitors over several days from a source counting them daily', () => {
		expect(forecast(requestWith([daily]))).toBe('summed')
		expect(forecast(requestWith([daily]), { timeframe: 'thisMonth' })).toBe('summed')
	})

	it('names one day, another metric and a source counting people once plainly', () => {
		const req = requestWith([daily])
		expect(forecast(req, { timeframe: 'today' })).toBe('plain')
		expect(
			forecast(req, { timeframe: 'custom', range: { from: '2026-10-01', to: '2026-10-01' } })
		).toBe('plain')
		expect(forecast(req, { metric: 'pageviews' })).toBe('plain')
		expect(forecast(requestWith([vendor]))).toBe('plain')
	})

	// The engine folds a source's days into weeks, adding up each day's visitors.
	it('forecasts a long trend of a source without weeks of its own as summed', () => {
		const req = requestWith([vendor])
		expect(forecast(req, { timeframe: 'last90days', series: true })).toBe('summed')
		expect(forecast(req, { timeframe: 'last30days', series: true })).toBe('plain')
	})

	it('leaves it to the read near the first of a month, where the zone decides the day count', () => {
		const req = requestWith([daily])
		const first = new Date('2026-11-01T03:00:00.000Z')
		expect(forecast(req, { timeframe: 'thisMonth', now: first })).toBe('unknown')
		expect(forecast(req, { timeframe: 'thisYear', now: first })).toBe('summed')
		expect(
			forecast(req, { timeframe: 'thisYear', now: new Date('2026-12-31T22:00:00.000Z') })
		).toBe('unknown')
	})

	it('knows a source counting people once reads plainly whatever the day count', () => {
		const first = new Date('2026-11-01T03:00:00.000Z')
		expect(forecast(requestWith([vendor]), { timeframe: 'thisMonth', now: first })).toBe('plain')
	})

	it('leaves it to the read where a scope can bring a source of its own', () => {
		const req = requestWith([daily], {
			resolveRegistry: async () => ({ registry: createRegistry([daily]), grants: new Map() }),
		})
		expect(forecast(req)).toBe('unknown')
		// A source the widget names from config is known all the same.
		expect(forecast(req, { dataSource: 'native' })).toBe('summed')
		expect(forecast(req, { dataSource: 'posthog:abc' })).toBe('unknown')
	})
})
