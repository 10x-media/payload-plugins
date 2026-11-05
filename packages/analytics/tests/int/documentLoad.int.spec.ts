import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
} from '@10x-media/payload-test-harness'
import { buildFormState } from '@payloadcms/ui/utilities/buildFormState'
import { createLocalReq } from 'payload'
import { isValidElement, type ReactNode } from 'react'
import { afterAll, beforeAll, expect, it, onTestFinished, vi } from 'vitest'
import { AnalyticsPanelField } from '../../src/fields/AnalyticsPanelField'
import { AnalyticsStatField } from '../../src/fields/AnalyticsStatField'
import { PANEL_FIELD_COMPONENT, STAT_FIELD_COMPONENT } from '../../src/fields/componentPaths'
import { analytics, analyticsTabsField } from '../../src/index'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { renderSettled } from '../../src/testing/renderSettled'
import { HOUR_MS } from '../../src/timeframe/tz'
import { callEndpoint } from './endpointHelpers'

/** What the server handed the panel's client half, one entry per render. */
const { handed } = vi.hoisted(() => ({ handed: [] as Array<Record<string, unknown>> }))

// The client half needs the admin's providers to render; what matters here is what it was handed.
vi.mock('../../src/fields/AnalyticsPanelClient', () => ({
	AnalyticsPanelClient: (props: Record<string, unknown>) => {
		handed.push(props)
		return null
	},
}))

const routes = routePaths(DEFAULT_ROUTE_BASE)

describeForDb('analytics panel on document load', {}, (db) => {
	let booted: BootedPayload
	let pageId: string
	let pageCreatedAt: string
	let user: Record<string, unknown> & { id: string | number }
	const memory = memoryAdapter()
	const query = vi.fn(memory.query)
	const source = { ...memory, query }

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [source],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug ? `/${String(doc.slug)}` : null) } },
			}),
			db,
			collections: [
				{
					slug: 'pages',
					fields: [{ name: 'slug', type: 'text' }, analyticsTabsField({ breakdowns: false })],
				},
			],
		})
		// The admin's generated import map, reduced to the two components a document renders.
		Reflect.set(booted.payload, 'importMap', {
			[PANEL_FIELD_COMPONENT]: AnalyticsPanelField,
			[STAT_FIELD_COMPONENT]: AnalyticsStatField,
		})
		const page = await booted.payload.create({
			collection: 'pages' as never,
			data: { slug: 'about' } as never,
		})
		pageId = String((page as { id: string | number }).id)
		pageCreatedAt = new Date((page as { createdAt?: string }).createdAt ?? '').toISOString()
		user = (await booted.payload.create({
			collection: booted.payload.config.admin.user as never,
			data: { email: `reader-${db}@t.dev`, password: 'test-password' } as never,
		})) as unknown as Record<string, unknown> & { id: string | number }
		memory.record({ path: '/about', timestamp: new Date(Date.now() - HOUR_MS) })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	/** Builds the edit view's form state as Payload does on load, then renders the panel in it. */
	const loadDocument = async (): Promise<Record<string, unknown>> => {
		const req = await createLocalReq(
			{ user: { ...user, collection: booted.payload.config.admin.user } as never },
			booted.payload
		)
		const doc = await booted.payload.findByID({ collection: 'pages' as never, id: pageId })
		const { state } = await buildFormState({
			id: pageId,
			collectionSlug: 'pages',
			data: doc as never,
			docPermissions: { fields: true } as never,
			docPreferences: { fields: {} },
			operation: 'update',
			renderAllFields: true,
			req,
			schemaPath: 'pages',
			skipValidation: true,
		})
		const field = state.analytics_panel?.customComponents?.Field
		// Payload wraps every field component in its condition watcher; the panel is its child.
		const panel: ReactNode = isValidElement<{ children?: ReactNode }>(field)
			? field.props.children
			: undefined
		expect(isValidElement(panel)).toBe(true)
		const before = handed.length
		await renderSettled(panel)
		expect(handed).toHaveLength(before + 1)
		return handed[before] ?? {}
	}

	it(`renders the panel without asking its source on ${db}`, async () => {
		query.mockClear()
		const props = await loadDocument()
		expect(query).not.toHaveBeenCalled()
		expect(props.seed).toBe('missing')
		expect(props.initial).toBeUndefined()
		// The form state's data carries the timestamp Payload keeps, which decides what "New" means.
		expect(props.createdAt).toBe(pageCreatedAt)
	})

	it(`seeds the panel from the cache a read filled, still without asking on ${db}`, async () => {
		// The endpoint and the panel find one cache entry only when both read the same day, which
		// they do on Payload's clock, set far from the wall clock's.
		const clock = installTestClock(new Date('2026-01-15T12:00:00.000Z'))
		onTestFinished(() => {
			clock.reset()
		})
		memory.record({ path: '/about', timestamp: new Date(clock.now().getTime() - HOUR_MS) })
		const params = new URLSearchParams({
			collection: 'pages',
			id: pageId,
			timeframe: 'last30days',
			compare: '1',
			series: '1',
			metrics: 'pageviews,visitors,sessions,avgDuration,conversions,revenue,scrollDepth',
		})
		const res = await callEndpoint(booted.payload, {
			path: routes.document,
			query: params,
			user: { ...user, collection: booted.payload.config.admin.user },
		})
		expect(res.status).toBe(200)
		const answered: unknown = await res.json()
		expect(answered).toMatchObject({ dateRange: { end: '2026-01-15T12:00:00.000Z' } })
		const asked = query.mock.calls.length
		expect(asked).toBeGreaterThan(0)

		const props = await loadDocument()
		expect(query).toHaveBeenCalledTimes(asked)
		expect(props.seed).toBe('fresh')
		expect(props.initial).toMatchObject({
			status: 'ok',
			metrics: { pageviews: 1 },
			dateRange: { start: expect.any(String), end: '2026-01-15T12:00:00.000Z' },
		})
	})
})
