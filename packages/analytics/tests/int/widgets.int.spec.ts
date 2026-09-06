import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { REALTIME_PATH } from '../../src/plugin/realtimeEndpoint'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

interface InspectedField {
	name?: string
	type?: string
	options?: Array<{ value?: string }>
	admin?: { components?: { Field?: { path?: string } } }
}

interface RegisteredWidget {
	slug: string
	fields?: InspectedField[]
}

// payload.config's widget types are deeply generic (TypedWidget); read them through a
// minimal shape to keep the inspection out of that recursive instantiation.
const registeredWidgets = (booted: BootedPayload): RegisteredWidget[] => {
	const config = booted.payload.config as unknown as {
		admin?: { dashboard?: { widgets?: RegisteredWidget[] } }
	}
	return config.admin?.dashboard?.widgets ?? []
}

describeForDb('analytics dashboard widgets', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the metric widget into the sanitized admin.dashboard.widgets', () => {
		const slugs = registeredWidgets(booted).map((w) => w.slug)
		expect(slugs).toContain('analytics-metric')
	})

	it('keeps the metric widget configurable (title, metric, timeframe fields)', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-metric')
		const fieldNames = (widget?.fields ?? []).map((f) => f.name).filter(Boolean)
		expect(fieldNames).toEqual(expect.arrayContaining(['title', 'metric', 'timeframe']))
	})

	it('registers the trend widget into the sanitized admin.dashboard.widgets', () => {
		const slugs = registeredWidgets(booted).map((w) => w.slug)
		expect(slugs).toContain('analytics-trend')
	})

	it('keeps the trend widget configurable (title, metric, timeframe fields)', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-trend')
		const fieldNames = (widget?.fields ?? []).map((f) => f.name).filter(Boolean)
		expect(fieldNames).toEqual(expect.arrayContaining(['title', 'metric', 'timeframe']))
	})

	it('registers all four breakdown widgets (native supports page/country/source/device)', () => {
		const slugs = registeredWidgets(booted).map((w) => w.slug)
		expect(slugs).toEqual(
			expect.arrayContaining([
				'analytics-breakdown-pages',
				'analytics-breakdown-sources',
				'analytics-breakdown-devices',
				'analytics-breakdown-countries',
			])
		)
	})

	it('gives breakdown widgets an editable title field', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-breakdown-pages')
		const fieldNames = (widget?.fields ?? []).map((f) => f.name).filter(Boolean)
		expect(fieldNames).toEqual(expect.arrayContaining(['title', 'metric', 'timeframe', 'limit']))
	})

	it('exposes a range group field on the metric widget', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-metric')
		const rangeField = (widget?.fields ?? []).find((f) => f.name === 'range')
		expect(rangeField).toBeDefined()
		expect(rangeField?.type).toBe('group')
	})

	it('exposes a range group field on the breakdown-pages widget', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-breakdown-pages')
		const rangeField = (widget?.fields ?? []).find((f) => f.name === 'range')
		expect(rangeField).toBeDefined()
		expect(rangeField?.type).toBe('group')
	})

	it('includes a custom option in the metric widget timeframe select', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-metric')
		const timeframeField = (widget?.fields ?? []).find((f) => f.name === 'timeframe')
		const values = (timeframeField?.options ?? []).map((o) => o.value)
		expect(values).toContain('custom')
	})

	it('includes a custom option in the breakdown-pages widget timeframe select', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-breakdown-pages')
		const timeframeField = (widget?.fields ?? []).find((f) => f.name === 'timeframe')
		const values = (timeframeField?.options ?? []).map((o) => o.value)
		expect(values).toContain('custom')
	})

	it('registers the realtime widget when native adapter is configured (native has realtime: true)', () => {
		const slugs = registeredWidgets(booted).map((w) => w.slug)
		expect(slugs).toContain('analytics-realtime')
	})

	it('gives the realtime widget metric and windowMinutes fields', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-realtime')
		const fieldNames = (widget?.fields ?? []).map((f) => f.name).filter(Boolean)
		expect(fieldNames).toEqual(expect.arrayContaining(['title', 'metric', 'windowMinutes']))
	})

	it('renders the metric field through MetricSelectField', () => {
		const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-metric')
		const metricField = (widget?.fields ?? []).find((f) => f.name === 'metric')
		expect(metricField?.admin?.components?.Field?.path).toBe(
			'@10x-media/analytics/client#MetricSelectField'
		)
	})
})

describeForDb(
	'analytics dashboard widgets, one adapter with providers.collection',
	{ dbs: ['mongo'] },
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({
				plugin: analytics({ adapters: [native()], providers: { collection: true } }),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('registers the dataSource field even with a single static adapter, because providers.collection makes runtime providers selectable', () => {
			const widget = registeredWidgets(booted).find((w) => w.slug === 'analytics-metric')
			const fieldNames = (widget?.fields ?? []).map((f) => f.name).filter(Boolean)
			expect(fieldNames).toContain('dataSource')
		})
	}
)

describeForDb(
	'analytics dashboard widgets, open-world gating with providers.collection',
	{ dbs: ['mongo'] },
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			// memoryAdapter has no realtime() method (despite capabilities.realtime: true),
			// so the endpoint registers here only because providers.collection makes the
			// gate open-world, not because the config adapter itself qualifies.
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
				(e): e is Endpoint => typeof e === 'object' && e.path === REALTIME_PATH
			)
			expect(endpoint).toBeDefined()
		})

		it('registers the realtime widget even though the only config adapter has no realtime handler', () => {
			const slugs = registeredWidgets(booted).map((w) => w.slug)
			expect(slugs).toContain('analytics-realtime')
		})
	}
)
