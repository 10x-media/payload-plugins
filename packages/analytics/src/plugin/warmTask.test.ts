import { describe, expect, it } from 'vitest'
import { deriveWarmTargets, type WarmWidgetInstance } from './warmTask'

const layout = (widgets: WarmWidgetInstance[]): WarmWidgetInstance[] => widgets

describe('deriveWarmTargets', () => {
	it('maps metric, trend, and breakdown widgets to their read targets', () => {
		const targets = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-metric', data: { metric: 'visitors', timeframe: 'last7days' } },
				{ widgetSlug: 'analytics-trend', data: { metric: 'pageviews', timeframe: 'last30days' } },
				{
					widgetSlug: 'analytics-breakdown-pages',
					data: { metric: 'pageviews', timeframe: 'last30days', limit: 8 },
				},
			])
		)
		expect(targets).toEqual([
			{
				kind: 'metric',
				metric: 'visitors',
				timeframe: 'last7days',
				range: undefined,
				adapterId: undefined,
			},
			{
				kind: 'series',
				metric: 'pageviews',
				timeframe: 'last30days',
				range: undefined,
				adapterId: undefined,
			},
			{
				kind: 'breakdown',
				metric: 'pageviews',
				dimension: 'page',
				timeframe: 'last30days',
				limit: 8,
				range: undefined,
				adapterId: undefined,
			},
		])
	})

	it('maps each breakdown slug to its dimension', () => {
		const dims = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-breakdown-sources' },
				{ widgetSlug: 'analytics-breakdown-devices' },
				{ widgetSlug: 'analytics-breakdown-countries' },
			])
		).map((t) => (t.kind === 'breakdown' ? t.dimension : null))
		expect(dims).toEqual(['source', 'device', 'country'])
	})

	it('skips the realtime widget and unknown / custom slugs', () => {
		const targets = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-realtime', data: { metric: 'visitors' } },
				{ widgetSlug: 'myapp-custom', data: { metric: 'pageviews' } },
				{ widgetSlug: undefined },
				{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', timeframe: 'today' } },
			])
		)
		expect(targets).toEqual([
			{
				kind: 'metric',
				metric: 'pageviews',
				timeframe: 'today',
				range: undefined,
				adapterId: undefined,
			},
		])
	})

	it('applies defaults (pageviews / last30days / limit 5) when data is missing', () => {
		const targets = deriveWarmTargets(
			layout([{ widgetSlug: 'analytics-metric' }, { widgetSlug: 'analytics-breakdown-pages' }])
		)
		expect(targets[0]).toEqual({
			kind: 'metric',
			metric: 'pageviews',
			timeframe: 'last30days',
			range: undefined,
			adapterId: undefined,
		})
		expect(targets[1]).toMatchObject({
			kind: 'breakdown',
			metric: 'pageviews',
			timeframe: 'last30days',
			limit: 5,
		})
	})

	it('carries the data source through as the adapter id', () => {
		const [target] = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', dataSource: 'plausible' } },
			])
		)
		expect(target?.adapterId).toBe('plausible')
	})

	it('de-duplicates identical targets', () => {
		const targets = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', timeframe: 'last30days' } },
				{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', timeframe: 'last30days' } },
			])
		)
		expect(targets).toHaveLength(1)
	})

	it('keeps a custom-range widget when its range resolves', () => {
		const [target] = deriveWarmTargets(
			layout([
				{
					widgetSlug: 'analytics-metric',
					data: {
						metric: 'pageviews',
						timeframe: 'custom',
						range: { from: '2026-01-01', to: '2026-01-31' },
					},
				},
			])
		)
		expect(target?.range).toEqual({ start: new Date('2026-01-01'), end: new Date('2026-01-31') })
	})

	it('skips a custom-timeframe widget whose range is incomplete', () => {
		const targets = deriveWarmTargets(
			layout([
				{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', timeframe: 'custom' } },
			])
		)
		expect(targets).toEqual([])
	})
})
