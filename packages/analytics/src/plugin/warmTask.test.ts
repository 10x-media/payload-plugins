import type { PayloadRequest, WidgetInstance } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readForWidget } = vi.hoisted(() => ({ readForWidget: vi.fn() }))
const { readForWidgetSeries } = vi.hoisted(() => ({ readForWidgetSeries: vi.fn() }))
const { readForWidgetBreakdown } = vi.hoisted(() => ({ readForWidgetBreakdown: vi.fn() }))

vi.mock('../widgets/readForWidget', () => ({ readForWidget }))
vi.mock('../widgets/readForWidgetSeries', () => ({ readForWidgetSeries }))
vi.mock('../widgets/readForWidgetBreakdown', () => ({ readForWidgetBreakdown }))

import { deriveWarmTargets, type WarmWidgetInstance, warmTask } from './warmTask'

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

	it('defaults an unknown metric string to pageviews', () => {
		const [target] = deriveWarmTargets(
			layout([{ widgetSlug: 'analytics-metric', data: { metric: 'not-a-real-metric' } }])
		)
		expect(target?.metric).toBe('pageviews')
	})
})

describe('warmTask handler scope fan-out', () => {
	const req = { payload: { logger: { warn: vi.fn() } } } as unknown as PayloadRequest

	beforeEach(() => {
		readForWidget.mockReset().mockResolvedValue({ status: 'ok' })
		readForWidgetSeries.mockReset().mockResolvedValue({ status: 'ok' })
		readForWidgetBreakdown.mockReset().mockResolvedValue({ status: 'ok' })
	})

	const runHandler = async (scopes?: () => string[]) => {
		const widgets = layout([
			{ widgetSlug: 'analytics-metric', data: { metric: 'pageviews', timeframe: 'last30days' } },
		])
		const task = warmTask('*/30 * * * *', widgets as unknown as WidgetInstance[], scopes)
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('warm handler must be a function')
		}
		const result = await handler({ req } as unknown as Parameters<typeof handler>[0])
		return (result as { output: { warmed: number; failed: number } }).output
	}

	it('runs each target once for the install-wide scope when no scopes resolver is set', async () => {
		const output = await runHandler()
		expect(readForWidget).toHaveBeenCalledTimes(1)
		expect(readForWidget.mock.calls[0]?.[0]).toMatchObject({ scope: null })
		expect(output).toEqual({ warmed: 1, failed: 0 })
	})

	it('runs each target once per scope, passing scope through explicitly', async () => {
		const output = await runHandler(() => ['t1', 't2'])
		expect(readForWidget).toHaveBeenCalledTimes(3)
		expect(readForWidget.mock.calls.map((call) => call[0]?.scope)).toEqual([null, 't1', 't2'])
		expect(output).toEqual({ warmed: 3, failed: 0 })
	})

	it('counts a failure independently per scope', async () => {
		readForWidget
			.mockResolvedValueOnce({ status: 'ok' })
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce({ status: 'ok' })
		const output = await runHandler(() => ['t1', 't2'])
		expect(output).toEqual({ warmed: 2, failed: 1 })
	})
})
