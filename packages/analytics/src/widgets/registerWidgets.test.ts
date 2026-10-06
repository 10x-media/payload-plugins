import type { Config, GroupField } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, DimensionKey, MetricKey } from '../core/contract'
import { native } from '../native/nativeAdapter'
import { memoryAdapter } from '../testing/memoryAdapter'
import { keys, type TranslationKey } from '../translations/keys'
import type { CustomWidgetDef } from './customWidget'
import { FILTER_DIMENSION_COMPONENT } from './filterField'
import {
	findMetricField,
	type RegisterWidgetsArgs,
	registerWidgets,
	widgetIsSupported,
} from './registerWidgets'
import { WIDGET_METRICS } from './types'

const bareConfig = (): Config => ({}) as Config

const fieldNames = (config: Config, slug: string): string[] =>
	(config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)?.fields ?? []).flatMap((f) =>
		'name' in f && typeof f.name === 'string' ? [f.name] : []
	)

const metricFieldOf = (config: Config, slug = 'analytics-metric') => {
	const widget = config.admin?.dashboard?.widgets?.find((w) => w.slug === slug)
	return widget?.fields ? findMetricField(widget.fields) : undefined
}

describe('widgetIsSupported', () => {
	it('keeps a widget when an adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['pageviews'] }, [native()])).toBe(true)
	})
	it('drops a widget when no adapter satisfies its requirement', () => {
		expect(widgetIsSupported({ metrics: ['bounceRate'] }, [native()])).toBe(false)
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
			path: '@10x-media/analytics/client#SourceSelectField',
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

	it('skips a widget whose metric select would have no options', () => {
		// `visits` is a contract metric the widget pickers deliberately do not offer, so an
		// adapter serving only it leaves the select empty.
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
			adapters: [native()],
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
		// All built-ins disabled leaves the built-in list empty; the custom widget must
		// still register, which only holds if custom defs are pushed before the
		// empty-list guard. Guards against a future reorder of those two steps.
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
		const names = fieldNames(register(), 'analytics-goals')
		expect(names).toEqual(['title', 'timeframe', 'range', 'limit', 'compare'])
	})

	it('offers 10, 25 and 50 rows, defaulting to 10', () => {
		const limit = goalsWidget(register())?.fields?.find((f) => 'name' in f && f.name === 'limit')
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
		const field = config.admin?.dashboard?.widgets
			?.find((w) => w.slug === slug)
			?.fields?.find((f) => 'name' in f && f.name === 'filter')
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
		const dimension = group?.fields.find((f) => 'name' in f && f.name === 'dimension')
		const component = dimension?.admin?.components?.Field
		expect(component && typeof component === 'object' ? component.path : '').toBe(
			FILTER_DIMENSION_COMPONENT
		)
	})
})
