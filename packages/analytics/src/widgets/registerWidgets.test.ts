import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, DimensionKey, MetricKey } from '../core/contract'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { findMetricField, registerWidgets, widgetIsSupported } from './registerWidgets'

const bareConfig = (): Config => ({}) as Config

const metricFieldOf = (config: Config, slug = 'analytics-metric') => {
	const widget = config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)
	return widget?.fields ? findMetricField(widget.fields) : undefined
}

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
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toContain('analytics-metric')
	})

	it('omits widgets named in the disabled list', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: ['analytics-metric'],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).not.toContain('analytics-metric')
	})

	it('adds a data-source field (labelled by adapter label) only with more than one adapter', () => {
		const single = bareConfig()
		registerWidgets(single, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const multi = bareConfig()
		registerWidgets(multi, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			disabled: [],
			register: [],
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

	it('renders the data-source field through SourceSelectField', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			disabled: [],
			register: [],
		})
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === 'analytics-metric')
			?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		expect(field?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#SourceSelectField',
		})
	})

	it('accepts an unset or runtime data-source value; rejects an empty string', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			disabled: [],
			register: [],
		})
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === 'analytics-metric')
			?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		if (field?.type !== 'select' || !field.validate) {
			throw new Error('dataSource select with validate not registered')
		}
		const validate = field.validate as (value: unknown) => unknown
		expect(validate(undefined)).toBe(true)
		expect(validate(null)).toBe(true)
		// A runtime (DB-registered) provider id, absent from the config-time options list.
		expect(validate('runtime-provider')).toBe(true)
		expect(validate('')).not.toBe(true)
	})

	it('renders the metric field through MetricSelectField, passing extra requirements as clientProps', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		expect(metricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#MetricSelectField',
		})
		const realtimeMetricField = metricFieldOf(config, 'analytics-realtime')
		expect(realtimeMetricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#MetricSelectField',
			clientProps: { requires: { realtime: true } },
		})
		const breakdownMetricField = metricFieldOf(config, 'analytics-breakdown-pages')
		expect(breakdownMetricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#MetricSelectField',
			clientProps: { requires: { dimensions: ['page'] } },
		})
	})

	it('narrows the metric picker to the selected data source via filterOptions', () => {
		const eventsOnly: AnalyticsAdapter = {
			id: 'events-only',
			label: 'Events only',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['events']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'events-only', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), eventsOnly],
			multiProvider: true,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		if (metricField?.type !== 'select' || !metricField.filterOptions) {
			throw new Error('metric select with filterOptions not registered')
		}
		const filterOptions = metricField.filterOptions
		const filter = (dataSource?: string) =>
			filterOptions({
				data: {},
				options: metricField.options,
				req: {} as never,
				siblingData: { dataSource },
			}).map((o) => (typeof o === 'object' ? o.value : o))
		expect(filter('events-only')).toEqual(['events'])
		expect(filter('native')).toContain('pageviews')
		// An id unknown at config time (runtime/DB provider) keeps the union.
		expect(filter('runtime-provider')).toEqual(
			(metricField.options as { value: string }[]).map((o) => o.value)
		)
	})

	it('clamps the metric default to a servable option', () => {
		const visitorsOnly: AnalyticsAdapter = {
			id: 'visitors-only',
			label: 'Visitors only',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['visitors']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'visitors-only', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [visitorsOnly],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		expect(metricField && 'defaultValue' in metricField && metricField.defaultValue).toBe(
			'visitors'
		)
	})

	it('skips a widget whose metric select would have no options', () => {
		const scrollOnly: AnalyticsAdapter = {
			id: 'scroll-only',
			label: 'Scroll only',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['scrollDepth']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'scroll-only', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [scrollOnly],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).not.toContain('analytics-metric')
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
		registerWidgets(config, {
			adapters: [noPageviews],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).not.toContain('analytics-trend')
		expect(slugs).toContain('analytics-metric')
	})

	it('filters the metric select to metrics a configured adapter supports', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		const values =
			metricField && 'options' in metricField
				? (metricField.options as { value: string }[]).map((o) => o.value)
				: []
		// native supports pageviews/visitors/sessions/events/avgDuration but not bounceRate.
		expect(values).toContain('pageviews')
		expect(values).toContain('events')
		expect(values).not.toContain('bounceRate')
	})

	it('narrows a breakdown widget metric select by both metric and dimension support', () => {
		// An adapter with the page dimension but only pageviews should offer only pageviews
		// on the page breakdown.
		const pagePageviews: AnalyticsAdapter = {
			id: 'pp',
			label: 'PP',
			capabilities: {
				...native().capabilities,
				metrics: new Set<MetricKey>(['pageviews', 'events']),
				dimensions: new Set<DimensionKey>(['page']),
			},
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'pp', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [pagePageviews],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config, 'analytics-breakdown-pages')
		const values =
			metricField && 'options' in metricField
				? (metricField.options as { value: string }[]).map((o) => o.value)
				: []
		expect(values).toEqual(expect.arrayContaining(['pageviews', 'events']))
		expect(values).not.toContain('visitors')
	})

	it('registers only the page breakdown when an adapter supports only the page dimension', () => {
		const pageOnly: AnalyticsAdapter = {
			id: 'pageonly',
			label: 'Page only',
			capabilities: { ...native().capabilities, dimensions: new Set<DimensionKey>(['page']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'pageonly', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [pageOnly],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toContain('analytics-breakdown-pages')
		expect(slugs).not.toContain('analytics-breakdown-sources')
		expect(slugs).not.toContain('analytics-breakdown-devices')
		expect(slugs).not.toContain('analytics-breakdown-countries')
	})

	it('registers a custom widget even when every built-in is disabled', () => {
		// All built-ins disabled leaves the built-in list empty; the custom widget must
		// still register, which only holds if custom defs are pushed before the
		// empty-list guard. Guards against a future reorder of those two steps.
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: [
				'analytics-metric',
				'analytics-trend',
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
				'analytics-realtime',
			],
			register: [{ slug: 'myapp-only', component: 'x#y', label: 'Mine' }],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(['myapp-only'])
	})

	it('marks widget title fields localized only when localizeText is set', () => {
		const titleFieldOf = (config: Config, slug: string) =>
			config.admin?.dashboard?.widgets
				?.find((w) => w.slug === slug)
				?.fields?.find((f) => 'name' in f && f.name === 'title')
		const plain = bareConfig()
		registerWidgets(plain, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const localized = bareConfig()
		registerWidgets(localized, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
			localizeText: true,
		})
		for (const slug of ['analytics-metric', 'analytics-realtime', 'analytics-breakdown-pages']) {
			const plainTitle = titleFieldOf(plain, slug)
			const localizedTitle = titleFieldOf(localized, slug)
			expect(plainTitle && 'localized' in plainTitle && plainTitle.localized).toBeFalsy()
			expect(localizedTitle && 'localized' in localizedTitle && localizedTitle.localized).toBe(true)
		}
	})

	it('preserves any widgets the host config already declared', () => {
		const config: Config = {
			admin: { dashboard: { widgets: [{ slug: 'host-widget', Component: 'x#y' }] } },
		} as Config
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(expect.arrayContaining(['host-widget', 'analytics-metric']))
	})
})
