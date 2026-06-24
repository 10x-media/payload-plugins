import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities } from '../core/contract'
import { buildCustomWidgets, type CustomWidgetDef } from './customWidget'

const caps = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsCapabilities => ({
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['source']),
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 10, aggregate: 300 },
	...over,
})

const adapter = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: caps(over),
	isConfigured: () => true,
	query: async () => ({ rows: [], meta: { provider: 'native', fetchedAt: '' } }),
})

const def = (over: Partial<CustomWidgetDef> = {}): CustomWidgetDef => ({
	slug: 'myapp-widget',
	component: '@/widgets/My#default',
	label: 'My widget',
	...over,
})

describe('buildCustomWidgets', () => {
	it('builds a supported widget, passing label/fields/widths through', () => {
		const out = buildCustomWidgets(
			[def({ minWidth: 'small', maxWidth: 'large', fields: [{ name: 'x', type: 'text' }] })],
			[adapter()],
			[]
		)
		expect(out).toEqual([
			{
				slug: 'myapp-widget',
				Component: '@/widgets/My#default',
				label: 'My widget',
				fields: [{ name: 'x', type: 'text' }],
				minWidth: 'small',
				maxWidth: 'large',
			},
		])
	})
	it('always builds a def with no requires', () => {
		expect(buildCustomWidgets([def()], [adapter()], [])).toHaveLength(1)
	})
	it('drops a def whose requires no adapter satisfies', () => {
		expect(
			buildCustomWidgets([def({ requires: { metrics: ['revenue'] } })], [adapter()], [])
		).toHaveLength(0)
	})
	it('keeps a def whose requires an adapter satisfies', () => {
		expect(
			buildCustomWidgets([def({ requires: { metrics: ['pageviews'] } })], [adapter()], [])
		).toHaveLength(1)
	})
	it('skips a disabled slug', () => {
		expect(buildCustomWidgets([def()], [adapter()], ['myapp-widget'])).toHaveLength(0)
	})
	it('throws on a reserved analytics- prefix', () => {
		expect(() => buildCustomWidgets([def({ slug: 'analytics-x' })], [adapter()], [])).toThrow(
			/reserved/
		)
	})
	it('throws on an empty slug', () => {
		expect(() => buildCustomWidgets([def({ slug: '' })], [adapter()], [])).toThrow()
	})
})
