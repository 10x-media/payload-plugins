import type { Config, Field, GroupField } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, DimensionKey, MetricKey } from '../core/contract'
import { BUILT_IN_WIDGET_SLUGS } from '../core/widgetSlugs'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { ar } from '../translations/ar'
import { en } from '../translations/en'
import { keys, type TranslationKey } from '../translations/keys'
import { createStaticLabels } from '../translations/staticLabel'
import { type CustomWidgetDef, widgetIsSupported } from './customWidget'
import { fieldByName, flattenRows } from './fieldRows'
import { FILTER_DIMENSION_COMPONENT } from './filterField'
import { findMetricField, type RegisterWidgetsArgs, registerWidgets } from './registerWidgets'
import { WIDGET_METRICS } from './types'

const bareConfig = (): Config => ({}) as Config

/** Names in stored order, rows flattened: a row is layout and changes no field's path. */
const fieldNames = (config: Config, slug: string): string[] =>
	flattenRows(config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.fields ?? []).flatMap(
		(f) => ('name' in f && typeof f.name === 'string' ? [f.name] : [])
	)

const metricFieldOf = (config: Config, slug = 'analytics-metric') => {
	const widget = config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)
	return widget?.fields ? findMetricField(widget.fields) : undefined
}

/** A source counting hits but no visits, so nothing about one: no bounce rate among them. */
const hitsOnly = (): AnalyticsAdapter => ({
	...native(),
	id: 'hits',
	capabilities: {
		...native().capabilities,
		metrics: new Set<MetricKey>(['pageviews', 'visitors', 'events', 'avgDuration']),
	},
})

describe('widgetIsSupported', () => {
	it('keeps a widget when an adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['pageviews'] }, [native()])).toBe(true)
		expect(widgetIsSupported({ metrics: ['bounceRate'] }, [native()])).toBe(true)
	})
	it('drops a widget when no adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['bounceRate'] }, [hitsOnly()])).toBe(false)
	})
	it('keeps a widget with no requirement', () => {
		expect(widgetIsSupported(undefined, [native()])).toBe(true)
	})
})

describe('registerWidgets', () => {
	// The slug list hosts type `widgets.overrides` against is written apart from the widgets
	// themselves, so this is what keeps the two from drifting.
	it('registers exactly the built-in slugs, in their listed order', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		expect((config.admin?.dashboard?.widgets ?? []).map((widget) => widget.slug)).toEqual([
			...BUILT_IN_WIDGET_SLUGS,
		])
	})

	it("adds its widgets after the host's own without changing the host's array", () => {
		const hostWidgets = [{ slug: 'host-widget', Component: './Host#Host' }]
		const config = { ...bareConfig(), admin: { dashboard: { widgets: hostWidgets } } }
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		expect(hostWidgets).toHaveLength(1)
		expect(config.admin.dashboard.widgets).not.toBe(hostWidgets)
		expect(config.admin.dashboard.widgets?.[0]?.slug).toBe('host-widget')
		expect(config.admin.dashboard.widgets?.map((w) => w.slug)).toContain('analytics-metric')
	})

	it('pushes the metric widget into admin.dashboard.widgets', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toContain('analytics-metric')
	})

	it('puts the compare checkbox on the trend widget only', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		expect(fieldNames(config, 'analytics-trend')).toContain('compare')
		expect(fieldNames(config, 'analytics-metric')).not.toContain('compare')
	})

	it('drops the compare checkbox when the host turned comparison off', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			comparison: false,
		})
		expect(fieldNames(config, 'analytics-trend')).not.toContain('compare')
	})

	it('omits widgets named in the disabled list', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
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
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const multi = bareConfig()
		registerWidgets(multi, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
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

	it('defaults the data-source field to the first adapter when defaultId is unset', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === 'analytics-metric')
			?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		expect(field && 'defaultValue' in field && field.defaultValue).toBe('native')
	})

	it('defaults the data-source field to defaultId when set', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
			disabled: [],
			register: [],
			defaultId: 'memory',
		})
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === 'analytics-metric')
			?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		expect(field && 'defaultValue' in field && field.defaultValue).toBe('memory')
	})

	it('renders the data-source field through SourceSelectField', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === 'analytics-metric')
			?.fields?.find((f) => 'name' in f && f.name === 'dataSource')
		expect(field?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/rsc#SourceSelectFieldServer',
		})
	})

	it('accepts an unset or runtime data-source value; rejects an empty string', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
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

	it('defaults the goals breakdown to conversions and every other breakdown to pageviews', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const defaultOf = (slug: string) => {
			const field = metricFieldOf(config, slug)
			return field && 'defaultValue' in field ? field.defaultValue : undefined
		}
		expect(defaultOf('analytics-breakdown-goals')).toBe('conversions')
		expect(defaultOf('analytics-breakdown-pages')).toBe('pageviews')
	})

	it('renders the metric field through MetricSelectField, passing extra requirements as clientProps', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		expect(metricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/rsc#MetricSelectFieldServer',
		})
		const realtimeMetricField = metricFieldOf(config, 'analytics-realtime')
		expect(realtimeMetricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/rsc#MetricSelectFieldServer',
			clientProps: { requires: { realtime: true } },
		})
		const breakdownMetricField = metricFieldOf(config, 'analytics-breakdown-pages')
		expect(breakdownMetricField?.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/rsc#MetricSelectFieldServer',
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
			providersEnabled: false,
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
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		expect(metricField && 'defaultValue' in metricField && metricField.defaultValue).toBe(
			'visitors'
		)
	})

	it('offers visits, which the view counts too', () => {
		const visitsOnly: AnalyticsAdapter = {
			id: 'visits-only',
			label: 'Visits only',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['visits']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'visits-only', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [visitsOnly],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		expect(metricField && 'options' in metricField ? metricField.options : []).toEqual([
			{ value: 'visits', label: expect.anything() },
		])
	})

	it('skips a widget whose metric select would have no options', () => {
		// The widget pickers offer every contract metric, so only an adapter serving none at
		// all empties the select. The guard is what keeps such a widget out of the drawer.
		const metricless: AnalyticsAdapter = {
			id: 'metricless',
			label: 'Metricless',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>() },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'metricless', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [metricless],
			multiProvider: false,
			providersEnabled: false,
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
			providersEnabled: false,
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
			adapters: [hitsOnly()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		const values =
			metricField && 'options' in metricField
				? (metricField.options as { value: string }[]).map((o) => o.value)
				: []
		expect(values).toContain('pageviews')
		expect(values).toContain('events')
		expect(values).not.toContain('bounceRate')
	})

	it('narrows a breakdown widget metric select by both metric and dimension support', () => {
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
			providersEnabled: false,
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
			providersEnabled: false,
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
		// With every built-in disabled the custom widget still registers only while custom defs
		// are pushed before the empty-list guard.
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [
				'analytics-metric',
				'analytics-trend',
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-channels',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
				'analytics-breakdown-goals',
				'analytics-breakdown-referrers',
				'analytics-breakdown-browsers',
				'analytics-breakdown-os',
				'analytics-breakdown-campaigns',
				'analytics-breakdown-events',
				'analytics-realtime',
				'analytics-goals',
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
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const localized = bareConfig()
		registerWidgets(localized, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
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
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(expect.arrayContaining(['host-widget', 'analytics-metric']))
	})

	it('with providersEnabled, registers the realtime widget and every breakdown widget alongside a single native adapter', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(
			expect.arrayContaining([
				'analytics-realtime',
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
			])
		)
	})

	it('registers the five new breakdown widgets with their label and default metric', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		const widgetsBySlug = new Map((config.admin?.dashboard?.widgets ?? []).map((w) => [w.slug, w]))
		const expectations: [slug: string, label: TranslationKey, defaultMetric: string][] = [
			['analytics-breakdown-referrers', keys.widgetBreakdownReferrers, 'pageviews'],
			['analytics-breakdown-browsers', keys.widgetBreakdownBrowsers, 'pageviews'],
			['analytics-breakdown-os', keys.widgetBreakdownOs, 'pageviews'],
			['analytics-breakdown-campaigns', keys.widgetBreakdownCampaigns, 'pageviews'],
			['analytics-breakdown-events', keys.widgetBreakdownEvents, 'events'],
		]
		for (const [slug, label, defaultMetric] of expectations) {
			const widget = widgetsBySlug.get(slug)
			expect(widget).toBeDefined()
			expect(
				widget?.label && (widget.label as (args: never) => string)({ t: (k: string) => k } as never)
			).toBe(label)
			const metricField = widget?.fields ? findMetricField(widget.fields) : undefined
			expect(metricField && 'defaultValue' in metricField && metricField.defaultValue).toBe(
				defaultMetric
			)
		}
	})

	it('skips the campaigns breakdown when no config adapter serves utmCampaign, but registers it when providersEnabled', () => {
		// memoryAdapter serves page/referrer/country/device only, so nothing in the install
		// answers a campaign breakdown until a runtime provider might.
		const withoutProviders = bareConfig()
		registerWidgets(withoutProviders, {
			adapters: [memoryAdapter()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const slugsWithout = withoutProviders.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugsWithout).not.toContain('analytics-breakdown-campaigns')

		const withProviders = bareConfig()
		registerWidgets(withProviders, {
			adapters: [memoryAdapter()],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		const slugsWith = withProviders.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugsWith).toContain('analytics-breakdown-campaigns')
	})

	it('registers the campaigns breakdown for a native-only install, which serves utmCampaign itself', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(
			expect.arrayContaining([
				'analytics-breakdown-referrers',
				'analytics-breakdown-browsers',
				'analytics-breakdown-os',
				'analytics-breakdown-campaigns',
			])
		)
	})

	it('with providersEnabled, the metric select lists every WIDGET_METRICS candidate (native lacks bounceRate)', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		const values =
			metricField && 'options' in metricField
				? (metricField.options as { value: string }[]).map((o) => o.value)
				: []
		expect(values).toEqual(WIDGET_METRICS)
	})

	it('with providersEnabled, registers a widget even when no adapter satisfies its requirement', () => {
		const noRealtimeNoDims: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: {
				...native().capabilities,
				realtime: false,
				dimensions: new Set<DimensionKey>(),
			},
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'limited', fetchedAt: '' } }),
		}
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [noRealtimeNoDims],
			multiProvider: false,
			providersEnabled: true,
			disabled: [],
			register: [],
		})
		const slugs = config.admin?.dashboard?.widgets?.map((w) => w.slug) ?? []
		expect(slugs).toEqual(
			expect.arrayContaining([
				'analytics-realtime',
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
			])
		)
	})
})

describe('registerWidgets: goals widget', () => {
	const register = (args: Partial<Parameters<typeof registerWidgets>[1]> = {}): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			...args,
		})
		return config
	}

	const goalsWidget = (config: Config) =>
		config.admin?.dashboard?.widgets?.find((w) => w.slug === 'analytics-goals')

	it('registers the goals widget with its own RSC component and label', () => {
		const widget = goalsWidget(register())
		expect(widget?.Component).toMatchObject({
			path: '@10x-media/analytics/rsc#AnalyticsGoalsWidget',
		})
		expect(
			widget?.label && (widget.label as (args: never) => string)({ t: (k: string) => k } as never)
		).toBe(keys.widgetGoals)
	})

	it('gives it a timeframe, custom range, limit and compare field', () => {
		// The custom range follows the row holding the timeframe it is conditioned on.
		const names = fieldNames(register(), 'analytics-goals')
		expect(names).toEqual(['title', 'timeframe', 'limit', 'range', 'compare'])
	})

	it('offers 10, 25 and 50 rows, defaulting to 10', () => {
		const limit = fieldByName(goalsWidget(register())?.fields ?? [], 'limit')
		expect(limit?.type).toBe('select')
		expect(limit && 'options' in limit ? limit.options : []).toEqual([
			{ value: '10', label: '10' },
			{ value: '25', label: '25' },
			{ value: '50', label: '50' },
		])
		expect(limit && 'defaultValue' in limit ? limit.defaultValue : undefined).toBe('10')
	})

	it('drops the compare checkbox when the host turned comparison off', () => {
		expect(fieldNames(register({ comparison: false }), 'analytics-goals')).not.toContain('compare')
	})

	it('adds the data-source field in a multi-provider install', () => {
		const names = fieldNames(
			register({ adapters: [native(), memoryAdapter()], multiProvider: true }),
			'analytics-goals'
		)
		expect(names).toContain('dataSource')
	})

	it('skips the widget when no config adapter serves conversions by goal', () => {
		const noGoals: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: { ...native().capabilities, dimensions: new Set<DimensionKey>(['page']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'limited', fetchedAt: '' } }),
		}
		const slugs = register({ adapters: [noGoals] }).admin?.dashboard?.widgets?.map((w) => w.slug)
		expect(slugs).not.toContain('analytics-goals')
		const withProviders = register({ adapters: [noGoals], providersEnabled: true })
		expect(withProviders.admin?.dashboard?.widgets?.map((w) => w.slug)).toContain('analytics-goals')
	})

	it('skips the widget when no config adapter serves conversions at all', () => {
		const noConversions: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: { ...native().capabilities, metrics: new Set<MetricKey>(['pageviews']) },
			isConfigured: () => true,
			query: async () => ({ rows: [], meta: { provider: 'limited', fetchedAt: '' } }),
		}
		const slugs = register({ adapters: [noConversions] }).admin?.dashboard?.widgets?.map(
			(w) => w.slug
		)
		expect(slugs).not.toContain('analytics-goals')
	})
})

describe('registerWidgets view link', () => {
	const custom: CustomWidgetDef = { slug: 'custom', component: 'x#Custom', label: 'Custom' }
	const view = { path: '/insights', defaultRange: 'today', defaultMetric: 'visitors' } as const

	const built = (view?: RegisterWidgetsArgs['view']): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [custom],
			...(view === undefined ? {} : { view }),
		})
		return config
	}

	const serverPropsOf = (config: Config, slug: string): Record<string, unknown> | undefined => {
		const component = config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.Component
		return typeof component === 'object' && component !== null && 'serverProps' in component
			? (component.serverProps as Record<string, unknown>)
			: undefined
	}

	it('hands every built-in widget the view path and the defaults it opens on', () => {
		const config = built(view)
		const builtIns = (config.admin?.dashboard?.widgets ?? []).filter((w) => w.slug !== custom.slug)
		expect(builtIns.length).toBeGreaterThan(0)
		for (const widget of builtIns) {
			expect(serverPropsOf(config, widget.slug)?.view).toEqual(view)
		}
	})

	it('hands them false when the app turned the view off', () => {
		expect(serverPropsOf(built(false), 'analytics-metric')?.view).toBe(false)
		expect(serverPropsOf(built(), 'analytics-metric')?.view).toBe(false)
	})

	it('leaves a host-registered widget alone', () => {
		expect(serverPropsOf(built(view), custom.slug)).toBeUndefined()
	})

	it('hands every widget the flag setting, defaulting it on', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			countryFlags: false,
		})
		for (const widget of config.admin?.dashboard?.widgets ?? []) {
			expect(serverPropsOf(config, widget.slug)?.countryFlags).toBe(false)
		}
		expect(serverPropsOf(built(), 'analytics-breakdown-countries')?.countryFlags).toBe(true)
	})
})

describe('registerWidgets: filter group', () => {
	const register = (args: Partial<Parameters<typeof registerWidgets>[1]> = {}): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			...args,
		})
		return config
	}

	const filterGroup = (config: Config, slug: string): GroupField | undefined => {
		const fields = config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.fields ?? []
		const field = fieldByName(fields, 'filter')
		return field && field.type === 'group' ? field : undefined
	}

	const filtered = ['analytics-metric', 'analytics-trend', 'analytics-breakdown-pages']

	it('puts the filter group on the metric, trend and breakdown widgets', () => {
		const config = register()
		for (const slug of filtered) {
			expect(fieldNames(config, slug)).toContain('filter')
		}
	})

	it('leaves the goals and realtime widgets unfiltered', () => {
		const config = register()
		expect(fieldNames(config, 'analytics-goals')).not.toContain('filter')
		expect(fieldNames(config, 'analytics-realtime')).not.toContain('filter')
	})

	it('places the group after the data source field in a multi-provider install', () => {
		const config = register({ adapters: [native(), memoryAdapter()], multiProvider: true })
		for (const slug of filtered) {
			const names = fieldNames(config, slug)
			expect(names.indexOf('filter')).toBeGreaterThan(names.indexOf('dataSource'))
			expect(names.at(-1)).toBe('filter')
		}
	})

	it('places the group last in a single-provider install too', () => {
		const config = register()
		for (const slug of filtered) {
			expect(fieldNames(config, slug).at(-1)).toBe('filter')
		}
	})

	it('carries the scoped pickers into every widget it registers', () => {
		const group = filterGroup(register(), 'analytics-breakdown-pages')
		const dimension = fieldByName(group?.fields ?? [], 'dimension')
		const component = dimension?.admin?.components?.Field
		expect(component && typeof component === 'object' ? component.path : '').toBe(
			FILTER_DIMENSION_COMPONENT
		)
	})
})

describe('registerWidgets: stored shape under the row layout', () => {
	const register = (args: Partial<Parameters<typeof registerWidgets>[1]> = {}): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native(), memoryAdapter()],
			multiProvider: true,
			providersEnabled: false,
			disabled: [],
			register: [],
			...args,
		})
		return config
	}

	const widgetFields = (config: Config, slug: string): Field[] =>
		config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.fields ?? []

	/** Every path a widget stores, rows flattened and named groups joined with a dot. */
	const storedPaths = (fields: Field[], prefix = ''): string[] =>
		flattenRows(fields).flatMap((field) => {
			if (!('name' in field) || typeof field.name !== 'string') {
				return []
			}
			const path = `${prefix}${field.name}`
			return field.type === 'group' && 'fields' in field
				? [path, ...storedPaths(field.fields, `${path}.`)]
				: [path]
		})

	/** Every row in a widget's tree, groups included, as its own list of fields. */
	const rowsOf = (fields: Field[]): Field[][] =>
		fields.flatMap((field) => {
			if (field.type === 'row') {
				return [field.fields, ...rowsOf(field.fields)]
			}
			return field.type === 'group' && 'fields' in field ? rowsOf(field.fields) : []
		})

	const isConditional = (field: Field): boolean =>
		'admin' in field && typeof field.admin?.condition === 'function'

	it('stores a breakdown widget at the paths it stored before the rows', () => {
		expect(storedPaths(widgetFields(register(), 'analytics-breakdown-pages'))).toEqual([
			'title',
			'metric',
			'timeframe',
			'range',
			'range.from',
			'range.to',
			'limit',
			'dataSource',
			'filter',
			'filter.dimension',
			'filter.operator',
			'filter.value',
		])
	})

	it('stores the trend widget at its own paths, compare included', () => {
		expect(storedPaths(widgetFields(register(), 'analytics-trend'))).toEqual([
			'title',
			'metric',
			'timeframe',
			'range',
			'range.from',
			'range.to',
			'dataSource',
			'compare',
			'filter',
			'filter.dimension',
			'filter.operator',
			'filter.value',
		])
	})

	it('stores the goals widget at its own paths', () => {
		expect(storedPaths(widgetFields(register(), 'analytics-goals'))).toEqual([
			'title',
			'timeframe',
			'limit',
			'range',
			'range.from',
			'range.to',
			'compare',
			'dataSource',
		])
	})

	it('never nests a stored path under a row in any widget', () => {
		for (const widget of register().admin?.dashboard?.widgets ?? []) {
			for (const row of rowsOf(widget.fields ?? [])) {
				// A row is layout: every field in one keeps the path it had on its own line.
				expect(row.every((field) => 'name' in field)).toBe(true)
			}
		}
	})

	it('never puts a conditional field in a row beside one that always shows', () => {
		for (const widget of register().admin?.dashboard?.widgets ?? []) {
			for (const row of rowsOf(widget.fields ?? [])) {
				// The custom range is the one conditional field, and a row whose other half
				// never disappears would leave a gap wherever the condition is false.
				expect([0, row.length]).toContain(row.filter(isConditional).length)
			}
		}
	})

	it('holds the same filter paths in a single-source install', () => {
		const paths = storedPaths(
			widgetFields(register({ adapters: [native()], multiProvider: false }), 'analytics-metric')
		)
		expect(paths).not.toContain('dataSource')
		expect(paths.filter((path) => path.startsWith('filter'))).toEqual([
			'filter',
			'filter.dimension',
			'filter.operator',
			'filter.value',
		])
	})
})

describe('registerWidgets: overrides', () => {
	const widgetOf = (config: Config, slug: string) =>
		config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)

	const built = (args: Partial<RegisterWidgetsArgs>): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			view: { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' },
			...args,
		})
		return config
	}

	it("puts the host's component in place of the plugin's, keeping the plugin's server props", () => {
		const config = built({
			overrides: { 'analytics-metric': { Component: '/widgets/Metric#Metric' } },
		})
		expect(widgetOf(config, 'analytics-metric')?.Component).toEqual({
			path: '/widgets/Metric#Metric',
			serverProps: {
				view: { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' },
				countryFlags: true,
			},
		})
		expect(widgetOf(config, 'analytics-trend')?.Component).toMatchObject({
			path: '@10x-media/analytics/rsc#AnalyticsTrendWidget',
		})
	})

	it("merges the host's own props over the plugin's in the object form", () => {
		const config = built({
			overrides: {
				'analytics-breakdown-countries': {
					Component: {
						path: '/widgets/Countries',
						exportName: 'Countries',
						clientProps: { dense: true },
						serverProps: { tone: 'quiet' },
					},
				},
			},
		})
		expect(widgetOf(config, 'analytics-breakdown-countries')?.Component).toEqual({
			path: '/widgets/Countries',
			exportName: 'Countries',
			clientProps: { dense: true },
			serverProps: {
				view: { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' },
				countryFlags: true,
				tone: 'quiet',
			},
		})
	})

	it('renames a widget and reshapes its settings from the defaults', () => {
		const config = built({
			overrides: {
				'analytics-trend': {
					label: { en: 'Traffic', de: 'Verkehr' },
					fields: ({ defaultFields }) => [
						...defaultFields.filter((field) => !('name' in field) || field.name !== 'title'),
						{ name: 'note', type: 'text' },
					],
				},
			},
		})
		const trend = widgetOf(config, 'analytics-trend')
		expect(trend?.label).toEqual({ en: 'Traffic', de: 'Verkehr' })
		expect(fieldNames(config, 'analytics-trend')).not.toContain('title')
		expect(fieldNames(config, 'analytics-trend')).toContain('note')
		expect(fieldNames(config, 'analytics-trend')).toContain('metric')
	})

	it('refuses a fields override that hands back no list', () => {
		expect(() =>
			built({
				overrides: { 'analytics-metric': { fields: () => ({}) as unknown as Field[] } },
			})
		).toThrow(/widgets\.overrides\.analytics-metric\.fields must return an array/)
	})

	it('hands a host flag component to every widget, for the rows it draws', () => {
		const flags = { Component: '/components/Flag#Flag' }
		const config = built({ countryFlags: flags })
		const component = widgetOf(config, 'analytics-breakdown-countries')?.Component
		expect(component).toMatchObject({ serverProps: { countryFlags: flags } })
	})
})

describe('registerWidgets: static labels', () => {
	const staticLabel = createStaticLabels({
		plugin: { de: { [keys.widgetFieldTitlePlaceholder]: 'z. B. Besuche heute' } },
	})

	const fieldOf = (config: Config, slug: string, name: string): Field | undefined =>
		fieldByName(config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.fields ?? [], name)

	const built = (): Config => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [native()],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
			staticLabel,
		})
		return config
	}

	it("writes a title placeholder in every language, the install's own strings first", () => {
		const title = fieldOf(built(), 'analytics-metric', 'title')
		const placeholder =
			title?.type === 'text' && typeof title.admin?.placeholder === 'object'
				? title.admin.placeholder
				: {}
		expect(placeholder.de).toBe('z. B. Besuche heute')
		expect(placeholder.en).toBe(en[keys.widgetFieldTitlePlaceholder])
		expect(Object.keys(placeholder)).toHaveLength(11)
	})

	it("names a breakdown's placeholder after the breakdown, in every language", () => {
		const title = fieldOf(built(), 'analytics-breakdown-countries', 'title')
		const placeholder =
			title?.type === 'text' && typeof title.admin?.placeholder === 'object'
				? title.admin.placeholder
				: {}
		expect(placeholder.ar).toBe(ar[keys.widgetBreakdownCountries])
	})

	it('writes each window in minutes as every language writes it', () => {
		const window = fieldOf(built(), 'analytics-realtime', 'windowMinutes')
		const options = window?.type === 'select' ? window.options : []
		const five = options.find((option) => typeof option === 'object' && option.value === '5')
		const label =
			typeof five === 'object' && typeof five.label === 'object'
				? (five.label as Record<string, string>)
				: {}
		expect(label.en).toBe(new Intl.NumberFormat('en', { style: 'unit', unit: 'minute' }).format(5))
		expect(label.ar).toBe(new Intl.NumberFormat('ar', { style: 'unit', unit: 'minute' }).format(5))
		expect(Object.keys(label)).toHaveLength(11)
	})

	it('labels the metric options through the install strings', () => {
		const metric = fieldOf(built(), 'analytics-metric', 'metric')
		const options = metric?.type === 'select' ? metric.options : []
		const pageviews = options.find((o) => typeof o === 'object' && o.value === 'pageviews')
		expect(typeof pageviews === 'object' ? pageviews.label : undefined).toEqual(
			staticLabel(keys.metricPageviews)
		)
	})
})

describe('registerWidgets: visits and sessions', () => {
	const both: AnalyticsAdapter = {
		id: 'vendor',
		label: 'Vendor',
		capabilities: {
			...native().capabilities,
			metrics: new Set<MetricKey>(['pageviews', 'visitors', 'visits', 'sessions']),
		},
		isConfigured: () => true,
		query: async () => ({ rows: [], meta: { provider: 'vendor', fetchedAt: '' } }),
	}

	it('offers the one count once, keeping visits only for a widget that already reads it', () => {
		const config = bareConfig()
		registerWidgets(config, {
			adapters: [both],
			multiProvider: false,
			providersEnabled: false,
			disabled: [],
			register: [],
		})
		const metricField = metricFieldOf(config)
		if (metricField?.type !== 'select' || !metricField.filterOptions) {
			throw new Error('metric select with filterOptions not registered')
		}
		const filterOptions = metricField.filterOptions
		const offered = (metric?: string) =>
			filterOptions({
				data: {},
				options: metricField.options,
				req: {} as never,
				siblingData: { metric },
			}).map((o) => (typeof o === 'object' ? o.value : o))
		expect(offered()).toEqual(['pageviews', 'visitors', 'sessions'])
		expect(offered('visits')).toEqual(['pageviews', 'visitors', 'visits', 'sessions'])
	})
})
