import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import {
	type CollectionConfig,
	type Config,
	type Field,
	generateImportMap,
	type ImportMap,
	type Widget,
	type WidgetServerProps,
} from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { type AnalyticsPluginOptions, resolveOptions } from '../../src/core/options'
import { analyticsTab } from '../../src/fields/factories'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { FLAG_DEPENDENCY, importMapPath, VIEW_DEPENDENCY } from '../../src/plugin/adminDependencies'
import { routePaths } from '../../src/plugin/routes'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { renderSettled } from '../../src/testing/renderSettled'
import { keys } from '../../src/translations/keys'
import { renderViewBody } from '../../src/view/viewBody'
import { type AnalyticsViewClientProps, resolveViewProps } from '../../src/view/viewProps'
import AnalyticsBreakdownWidget from '../../src/widgets/AnalyticsBreakdownWidget'
import { fieldByName } from '../../src/widgets/fieldRows'
import { readerRequest } from './readerRequest'

const HOST_FLAG = { path: '/components/HostFlag', exportName: 'HostFlag' }
const HOST_VIEW = '/components/HostView#HostView'
const HOST_METRIC = '/components/HostMetric#HostMetric'

/** A source answering every country breakdown with the same two rows. */
const countriesAdapter = (): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'countries',
		label: 'Countries',
		query: async (q, context) =>
			q.dimensions?.includes('country')
				? {
						rows: [
							{ dimensions: { country: 'DE' }, metrics: { pageviews: 9 } },
							{ dimensions: { country: 'FR' }, metrics: { pageviews: 4 } },
						],
						meta: { provider: 'countries', fetchedAt: new Date().toISOString() },
					}
				: base.query(q, context),
	}
}

const pages: CollectionConfig = {
	slug: 'pages',
	fields: [
		{ name: 'slug', type: 'text' },
		{ type: 'tabs', tabs: [analyticsTab()] },
	],
}

const options: AnalyticsPluginOptions = {
	adapters: [countriesAdapter()],
	collections: { pages: { pathField: 'slug' } },
	goals: { collection: true },
	view: { Component: HOST_VIEW },
	countryFlags: { Component: HOST_FLAG },
	widgets: {
		overrides: {
			'analytics-metric': { Component: HOST_METRIC },
			'analytics-breakdown-countries': {
				label: { en: 'Where people come from' },
				fields: ({ defaultFields }: { defaultFields: Field[] }) => [
					...defaultFields,
					{ name: 'note', type: 'text' },
				],
			},
		},
	},
	translations: {
		de: { [keys.adminGroup]: 'Statistik-Einstellungen', [keys.tabAnalytics]: 'Statistik' },
	},
}

const t = (key: string): string => key

/** A `'use client'` module's export, as the import map holds it on the server. */
const asClientReference = <T extends object>(component: T): T =>
	Object.assign(component, { $$typeof: Symbol.for('react.client.reference') })

const HostFlag = asClientReference(({ code }: { code: string }) =>
	createElement('i', { className: 'host-flag', 'data-code': code })
)

/** The host's components as an import map built from these paths would hold them. */
const hostImportMap = (): ImportMap => ({
	[importMapPath(HOST_FLAG)]: HostFlag,
	[HOST_VIEW]: (props: AnalyticsViewClientProps) =>
		createElement(
			'section',
			{ className: 'host-view' },
			typeof props.countryFlags === 'object'
				? createElement(props.countryFlags.Component, { code: 'DE' })
				: null
		),
})

describeForDb('customizing: overrides end to end', {}, (db) => {
	let booted: BootedPayload
	let importMapDir: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics(options),
			db,
			collections: [pages],
			configOverrides: {
				i18n: { translations: { de: { analytics: { metricPageviews: 'Aufrufe' } } } },
			},
		})
		importMapDir = await mkdtemp(join(tmpdir(), 'analytics-import-map-'))
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
		await rm(importMapDir, { recursive: true, force: true })
	})

	const widget = (slug: string): Widget | undefined => {
		const widgets = (booted.payload.config.admin.dashboard?.widgets ?? []) as unknown as Widget[]
		return widgets.find((w) => w.slug === slug)
	}

	it("registers the host's widget component with the plugin's server props, its name and fields", () => {
		const component: unknown = widget('analytics-metric')?.Component
		expect(component).toMatchObject({
			path: HOST_METRIC,
			serverProps: { view: { path: '/analytics' }, countryFlags: { Component: HOST_FLAG } },
		})
		const countries = widget('analytics-breakdown-countries')
		expect(countries?.label).toEqual({ en: 'Where people come from' })
		expect(countries?.fields?.some((f) => 'name' in f && f.name === 'note')).toBe(true)
	})

	it('renders the host widget the way Payload renders a widget, with the server props kept', () => {
		const seen: Record<string, unknown>[] = []
		const HostMetric = (props: Record<string, unknown>) => {
			seen.push(props)
			return createElement('output', null, String(props.widgetSlug))
		}
		// What Payload's `renderWidgetHandler` (ModularDashboard) does with a widget's `Component`.
		const node = RenderServerComponent({
			Component: widget('analytics-metric')?.Component,
			importMap: { [HOST_METRIC]: HostMetric },
			serverProps: { widgetSlug: 'analytics-metric', widgetData: {} },
		})
		expect(renderToStaticMarkup(createElement('div', null, node))).toContain(
			'<output>analytics-metric</output>'
		)
		expect(seen[0]).toMatchObject({
			view: { path: '/analytics' },
			countryFlags: { Component: HOST_FLAG },
		})
	})

	it('lists the flag and the view body as admin dependencies, which reach the import map', async () => {
		const { dependencies } = booted.payload.config.admin
		expect(dependencies?.[FLAG_DEPENDENCY]).toEqual({
			type: 'component',
			path: '/components/HostFlag#HostFlag',
		})
		expect(dependencies?.[VIEW_DEPENDENCY]).toEqual({ type: 'component', path: HOST_VIEW })
		const file = join(importMapDir, 'importMap.js')
		const config = {
			...booted.payload.config,
			admin: {
				...booted.payload.config.admin,
				importMap: { ...booted.payload.config.admin.importMap, importMapFile: file },
			},
		}
		await generateImportMap(config, { log: false, force: true })
		const written = await readFile(file, 'utf8')
		for (const key of ['/components/HostFlag#HostFlag', HOST_VIEW, HOST_METRIC]) {
			expect(written).toContain(`"${key}"`)
		}
	})

	it('mounts no flag route for a flag of the host', () => {
		const flags = routePaths(resolveOptions(options).routes.base).flagsPattern
		expect(booted.payload.config.endpoints.some((e) => e.path === flags)).toBe(false)
	})

	it("renders the host's view body with the view's props and the host's flag component", async () => {
		booted.payload.importMap = hostImportMap()
		const req = readerRequest(booted.payload, { i18n: { t, language: 'en' } })
		const resolved = resolveOptions(options)
		const result = await resolveViewProps(req, resolved)
		if (result.denied) throw new Error('expected access')
		const html = renderToStaticMarkup(
			createElement(
				'div',
				null,
				renderViewBody({ resolved, props: result.props, importMap: booted.payload.importMap })
			)
		)
		expect(html).toContain('class="host-view"')
		expect(html).toContain('class="host-flag" data-code="DE"')
	})

	it("draws the host's flag on each row of the countries widget", async () => {
		booted.payload.importMap = hostImportMap()
		const countries = widget('analytics-breakdown-countries')?.Component
		const serverProps =
			typeof countries === 'object' && countries && 'serverProps' in countries
				? countries.serverProps
				: {}
		const html = await renderSettled(
			AnalyticsBreakdownWidget({
				req: readerRequest(booted.payload, { i18n: { t, language: 'en' } }),
				widgetSlug: 'analytics-breakdown-countries',
				widgetData: {},
				...serverProps,
			} as unknown as WidgetServerProps)
		)
		expect([...html.matchAll(/data-code="([A-Z]+)"/g)].map((m) => m[1])).toEqual(['DE', 'FR'])
	})

	it("names the plugin's places with the app's strings over the plugin's over the built-in", () => {
		const goals = booted.payload.config.collections.find((c) => c.slug === GOALS_SLUG)
		const group = goals?.admin?.group
		expect(typeof group === 'object' && group ? Reflect.get(group, 'de') : undefined).toBe(
			'Statistik-Einstellungen'
		)
		const metric = fieldByName(widget('analytics-metric')?.fields ?? [], 'metric')
		const pageviews =
			metric && 'options' in metric
				? metric.options.find((o) => typeof o === 'object' && o.value === 'pageviews')
				: undefined
		const label = typeof pageviews === 'object' ? pageviews.label : undefined
		expect(typeof label === 'object' && label ? Reflect.get(label, 'de') : undefined).toBe(
			'Aufrufe'
		)
		const tab = booted.payload.config.collections
			.find((c) => c.slug === 'pages')
			?.fields.flatMap((f) => ('tabs' in f ? f.tabs.flatMap((tab) => tab.fields) : []))
			.find((f) => f.type === 'ui')
		const tabLabel = tab && 'label' in tab ? tab.label : undefined
		expect(typeof tabLabel === 'object' && tabLabel ? Reflect.get(tabLabel, 'de') : undefined).toBe(
			'Statistik'
		)
	})
})

describe('customizing: the plugin flag route', () => {
	it('is mounted only while the plugin draws its own flags', async () => {
		const flagged = (countryFlags: AnalyticsPluginOptions['countryFlags']) =>
			analytics({ adapters: [memoryAdapter()], countryFlags })({
				collections: [],
			} as unknown as Config)
		const mounted = async (countryFlags: AnalyticsPluginOptions['countryFlags']) => {
			const config = await flagged(countryFlags)
			return (config.endpoints ?? []).some((e) => e.path.includes('flags'))
		}
		expect(await mounted(true)).toBe(true)
		expect(await mounted(undefined)).toBe(true)
		expect(await mounted(false)).toBe(false)
		expect(await mounted({ Component: '/components/Flag#Flag' })).toBe(false)
		const config = await flagged({ Component: '/components/Flag#Flag' })
		expect(config.admin?.dependencies?.[FLAG_DEPENDENCY]?.path).toBe('/components/Flag#Flag')
	})
})
