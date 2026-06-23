import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'

interface RegisteredWidget {
	slug: string
	fields?: Array<{ name?: string }>
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
})
