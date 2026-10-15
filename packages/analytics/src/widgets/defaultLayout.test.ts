import type { Payload, PayloadRequest, WidgetInstance } from 'payload'
import { describe, expect, it } from 'vitest'
import { type AnalyticsAdapter, DIMENSION_KEYS } from '../core/contract'
import { isMetricKey } from '../core/guards'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { METRIC_KEYS } from '../translations/metricKeys'
import { analyticsDefaultLayout } from './defaultLayout'
import { analyticsDefaultWidgets } from './defaults'

const capable = (): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		capabilities: {
			...base.capabilities,
			metrics: new Set(Object.keys(METRIC_KEYS).filter(isMetricKey)),
			dimensions: new Set(DIMENSION_KEYS),
		},
	}
}

const reqReading = (
	adapter: AnalyticsAdapter,
	overrides: Partial<AnalyticsRuntime> = {}
): PayloadRequest => {
	const payload = {} as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (source, query) => source.query(query, {}) },
		ttl: {},
		comparison: true,
		...overrides,
	})
	return { user: { id: 1 }, payload } as unknown as PayloadRequest
}

const slugsOf = (layout: WidgetInstance[]): string[] => layout.map((w) => w.widgetSlug)

describe('analyticsDefaultLayout', () => {
	it('places every default widget for a source that can answer them all', async () => {
		const layout = await analyticsDefaultLayout()({ req: reqReading(capable()) })
		expect(layout).toEqual(analyticsDefaultWidgets())
	})

	it('drops what the reader default source cannot answer, keeping what it can', async () => {
		const slugs = slugsOf(await analyticsDefaultLayout()({ req: reqReading(memoryAdapter()) }))
		// The memory source breaks down by page, referrer, country and device, and counts no goals.
		expect(slugs).toEqual([
			'analytics-metric',
			'analytics-metric',
			'analytics-trend',
			'analytics-realtime',
			'analytics-breakdown-pages',
			'analytics-breakdown-devices',
			'analytics-breakdown-countries',
			'analytics-breakdown-referrers',
		])
	})

	it('drops a breakdown whose dimension the source lacks', async () => {
		const adapter = capable()
		const dimensions = new Set(adapter.capabilities.dimensions)
		dimensions.delete('browser')
		const lacking = { ...adapter, capabilities: { ...adapter.capabilities, dimensions } }
		const slugs = slugsOf(await analyticsDefaultLayout()({ req: reqReading(lacking) }))
		expect(slugs).not.toContain('analytics-breakdown-browsers')
		expect(slugs).toHaveLength(analyticsDefaultWidgets().length - 1)
	})

	it('drops the realtime widget for a source without realtime', async () => {
		const adapter = capable()
		const historical = { ...adapter, capabilities: { ...adapter.capabilities, realtime: false } }
		const slugs = slugsOf(await analyticsDefaultLayout()({ req: reqReading(historical) }))
		expect(slugs).not.toContain('analytics-realtime')
	})

	it('keeps a widget that names its own source, and widgets that are not the plugin own', async () => {
		const widgets: WidgetInstance[] = [
			{ widgetSlug: 'analytics-breakdown-browsers', width: 'medium', data: { dataSource: 'ga4' } },
			{ widgetSlug: 'host-welcome', width: 'full' } as unknown as WidgetInstance,
			{ widgetSlug: 'analytics-breakdown-browsers', width: 'medium' },
		]
		const layout = await analyticsDefaultLayout({ widgets })({ req: reqReading(memoryAdapter()) })
		expect(layout).toEqual(widgets.slice(0, 2))
	})

	it('places the whole list when the reader has no source to read', async () => {
		const req = reqReading(memoryAdapter(), { readAccess: () => false })
		expect(await analyticsDefaultLayout()({ req })).toEqual(analyticsDefaultWidgets())
	})

	it('places the whole list when the plugin has no runtime', async () => {
		const req = { user: { id: 1 }, payload: {} } as unknown as PayloadRequest
		expect(await analyticsDefaultLayout()({ req })).toEqual(analyticsDefaultWidgets())
	})
})
