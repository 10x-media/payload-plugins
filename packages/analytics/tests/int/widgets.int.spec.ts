import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { fieldByName, flattenRows } from '../../src/widgets/fieldRows'

const routes = routePaths(DEFAULT_ROUTE_BASE)

interface RegisteredWidget {
	slug: string
	fields?: Field[]
}

// payload.config's widget types are deeply generic (TypedWidget); read them through a
// minimal shape to keep the inspection out of that recursive instantiation.
const registeredWidgets = (booted: BootedPayload): RegisteredWidget[] => {
	const config = booted.payload.config as unknown as {
		admin?: { dashboard?: { widgets?: RegisteredWidget[] } }
	}
	return config.admin?.dashboard?.widgets ?? []
}

const widgetSlugs = (booted: BootedPayload): string[] =>
	registeredWidgets(booted).map((w) => w.slug)

const widget = (booted: BootedPayload, slug: string): RegisteredWidget | undefined =>
	registeredWidgets(booted).find((w) => w.slug === slug)

/**
 * Every field a widget's form holds, flattened through its unnamed `row` wrappers: a row stores
 * nothing, so no assertion should depend on which line an input sits on.
 */
const fieldNames = (found: RegisteredWidget | undefined): string[] =>
	flattenRows(found?.fields ?? []).flatMap((field) => ('name' in field ? [field.name] : []))

const namedField = (found: RegisteredWidget | undefined, name: string): Field | undefined =>
	fieldByName(found?.fields ?? [], name)

const selectValues = (field: Field | undefined): Array<string | undefined> =>
	field?.type === 'select'
		? field.options.map((option) => (typeof option === 'string' ? option : option.value))
		: []

/** The `admin.components.Field` path a field renders through, in either declared form. */
const componentPath = (field: Field | undefined): string | undefined => {
	const component =
		field && 'admin' in field && field.admin && 'components' in field.admin
			? field.admin.components?.Field
			: undefined
	if (typeof component === 'string') {
		return component
	}
	return component && typeof component === 'object' && 'path' in component
		? component.path
		: undefined
}

describeForDb('analytics dashboard widgets', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the metric widget into the sanitized admin.dashboard.widgets', () => {
		expect(widgetSlugs(booted)).toContain('analytics-metric')
	})

	it('keeps the metric widget configurable (title, metric, timeframe fields)', () => {
		expect(fieldNames(widget(booted, 'analytics-metric'))).toEqual(
			expect.arrayContaining(['title', 'metric', 'timeframe'])
		)
	})

	it('registers the trend widget into the sanitized admin.dashboard.widgets', () => {
		expect(widgetSlugs(booted)).toContain('analytics-trend')
	})

	it('keeps the trend widget configurable (title, metric, timeframe fields)', () => {
		expect(fieldNames(widget(booted, 'analytics-trend'))).toEqual(
			expect.arrayContaining(['title', 'metric', 'timeframe'])
		)
	})

	it('registers all four breakdown widgets (native supports page/country/source/device)', () => {
		expect(widgetSlugs(booted)).toEqual(
			expect.arrayContaining([
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
			])
		)
	})

	it('gives breakdown widgets an editable title field', () => {
		expect(fieldNames(widget(booted, 'analytics-breakdown-pages'))).toEqual(
			expect.arrayContaining(['title', 'metric', 'timeframe', 'limit'])
		)
	})

	it('exposes a range group field on the metric widget', () => {
		const rangeField = namedField(widget(booted, 'analytics-metric'), 'range')
		expect(rangeField).toBeDefined()
		expect(rangeField?.type).toBe('group')
	})

	it('exposes a range group field on the breakdown-pages widget', () => {
		const rangeField = namedField(widget(booted, 'analytics-breakdown-pages'), 'range')
		expect(rangeField).toBeDefined()
		expect(rangeField?.type).toBe('group')
	})

	it('includes a custom option in the metric widget timeframe select', () => {
		expect(selectValues(namedField(widget(booted, 'analytics-metric'), 'timeframe'))).toContain(
			'custom'
		)
	})

	it('includes a custom option in the breakdown-pages widget timeframe select', () => {
		expect(
			selectValues(namedField(widget(booted, 'analytics-breakdown-pages'), 'timeframe'))
		).toContain('custom')
	})

	it('registers the realtime widget when native adapter is configured (native has realtime: true)', () => {
		expect(widgetSlugs(booted)).toContain('analytics-realtime')
	})

	it('gives the realtime widget metric and windowMinutes fields', () => {
		expect(fieldNames(widget(booted, 'analytics-realtime'))).toEqual(
			expect.arrayContaining(['title', 'metric', 'windowMinutes'])
		)
	})

	it('renders the metric field through MetricSelectField', () => {
		expect(componentPath(namedField(widget(booted, 'analytics-metric'), 'metric'))).toBe(
			'@10x-media/analytics/rsc#MetricSelectFieldServer'
		)
	})
})

describeForDb('analytics dashboard widgets, one adapter with providers.collection', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				providers: { collection: true },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the dataSource field even with a single static adapter, because providers.collection makes runtime providers selectable', () => {
		expect(fieldNames(widget(booted, 'analytics-metric'))).toContain('dataSource')
	})
})

describeForDb(
	'analytics dashboard widgets, open-world gating with providers.collection',
	{},
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			// memoryAdapter has no realtime() despite `capabilities.realtime: true`, so the endpoint
			// registers only because providers.collection makes the gate open-world.
			booted = await bootPayload({
				plugin: analytics({ adapters: [memoryAdapter()], providers: { collection: true } }),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('registers the realtime endpoint even though the only config adapter has no realtime handler', () => {
			const endpoint = (booted.payload.config.endpoints ?? []).find(
				(e): e is Endpoint => typeof e === 'object' && e.path === routes.live
			)
			expect(endpoint).toBeDefined()
		})

		it('registers the realtime widget even though the only config adapter has no realtime handler', () => {
			expect(widgetSlugs(booted)).toContain('analytics-realtime')
		})
	}
)
