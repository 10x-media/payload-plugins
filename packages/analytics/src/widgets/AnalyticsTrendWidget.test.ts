import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { resolveTimeframe } from '../timeframe/presets'
import AnalyticsTrendWidget from './AnalyticsTrendWidget'
import { previousWindow } from './comparison'
import { formatRangeCaption } from './range'
import type { MetricWidgetData } from './types'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(),
	filters: new Set(),
	filterOperators: new Set(['eq']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
}

const adapter: AnalyticsAdapter = {
	id: 'native',
	label: 'Native',
	capabilities,
	isConfigured: () => true,
	async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		return {
			rows: [{ timestamp: q.dateRange.start.toISOString(), metrics: { pageviews: 4 } }],
			totals: { pageviews: 4 },
			meta: { provider: 'native', fetchedAt: NOW.toISOString() },
		}
	},
}

const req = (): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set(['native']),
		bindings: {},
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload, i18n: { t: (key: string) => key, language: 'en' } } as unknown as PayloadRequest
}

const renderWidget = async (widgetData: MetricWidgetData): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsTrendWidget({ req: req(), widgetData } as unknown as WidgetServerProps)
	)

describe('AnalyticsTrendWidget comparison', () => {
	// The chart injects its stylesheet inline, so every class name appears in the markup
	// either way; assertions match the rendered element instead.
	it('overlays the previous period when compare is on', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days', compare: true })
		expect(html).toContain('<div class="analytics-chart__legend">')
		expect(html).toContain('analytics:viewTrendPrevious')
	})

	it('names the previous range beside the legend label', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days', compare: true })
		const range = previousWindow(resolveTimeframe('last7days', new Date(), 'UTC'), 'UTC')
		expect(range).not.toBeNull()
		if (!range) {
			return
		}
		expect(html).toContain(formatRangeCaption(range, 'en', 'UTC'))
	})

	it('draws one series when compare is off', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		expect(html).not.toContain('<div class="analytics-chart__legend">')
		// The period-over-period delta is independent of the overlay.
		expect(html).toContain('analytics:comparisonVsPrevious')
	})
})
