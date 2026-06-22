import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { registerWidgets, widgetIsSupported } from './registerWidgets'

const bareConfig = (): Config => ({}) as Config

describe('widgetIsSupported', () => {
	it('keeps a widget when an adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['pageviews'] }, [native()])).toBe(true)
	})
	it('drops a widget when no adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['scrollDepth'] }, [native()])).toBe(false)
	})
	it('keeps a widget with no requirement', () => {
		expect(widgetIsSupported(undefined, [native()])).toBe(true)
	})
})

describe('registerWidgets', () => {
	it('pushes the metric widget into admin.dashboard.widgets', () => {
		const config = bareConfig()
		registerWidgets(config, { adapters: [native()], multiProvider: false, disabled: [] })
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toContain('analytics-metric')
	})

	it('omits widgets named in the disabled list', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: ['analytics-metric'],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).not.toContain('analytics-metric')
	})

	it('adds a data-source field (labelled by adapter label) only with more than one adapter', () => {
		const single = bareConfig()
		registerWidgets(single, { adapters: [native()], multiProvider: false, disabled: [] })
		const multi = bareConfig()
		registerWidgets(multi, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			disabled: [],
		})
		const dataSourceField = (config: Config) =>
			config.admin?.dashboard?.widgets
				?.find((w) => w.slug === 'analytics-metric')
				?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		expect(dataSourceField(single)).toBeUndefined()
		const field = dataSourceField(multi)
		expect(field).toBeDefined()
		const options = field && 'options' in field ? field.options : []
		expect(options).toEqual([
			{ value: 'native', label: native().label },
			{ value: 'memory', label: memoryAdapter().label },
		])
	})

	it('drops the trend widget when no adapter supports its required metric', () => {
		const noPageviews: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['visitors']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'limited', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, { adapters: [noPageviews], multiProvider: false, disabled: [] })
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).not.toContain('analytics-trend')
		expect(slugs).toContain('analytics-metric')
	})

	it('preserves any widgets the host config already declared', () => {
		const config: Config = {
			admin: { dashboard: { widgets: [{ slug: 'host-widget', Component: 'x#y' }] } },
		} as Config
		registerWidgets(config, { adapters: [native()], multiProvider: false, disabled: [] })
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(expect.arrayContaining(['host-widget', 'analytics-metric']))
	})
})
