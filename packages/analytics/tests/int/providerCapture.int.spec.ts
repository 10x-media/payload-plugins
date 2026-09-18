import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { handleEndpoints } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { ga4ExcludeGuard } from '../../src/adapters/ga4/disableKey'
import type { TrackerConfig } from '../../src/capture/trackerConfig'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { adapterFromProviderDoc } from '../../src/providers/factory'
import { AnalyticsScripts } from '../../src/rsc/AnalyticsScripts'

const SECRET = 'phx_private_query_key'
const TOKEN = 'phc_tenant_public'
const EU_ASSETS = 'https://eu-assets.i.posthog.com'
const MEASUREMENT_ID = 'G-AB12CD34'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/** The provider-settings document a tenant would save in the providers collection. */
const tenantDoc = {
	id: 'tenant-a',
	name: 'Tenant PostHog',
	provider: 'posthog',
	enabled: true,
	scope: 'tenant-a',
	posthog: { projectId: '42', apiKey: SECRET, projectToken: TOKEN, region: 'eu' },
}

// A document's adapter carries its instance id (provider:docId), which is what the tenant
// slot names; the config adapter stays the default, so the slot has to be explicit.
describeForDb('analytics capture from a provider document', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				providers: {
					resolve: ({ scope }) => {
						const adapter = scope === 'tenant-a' ? adapterFromProviderDoc(tenantDoc) : null
						return adapter ? [adapter] : []
					},
				},
				capture: { slots: { tenant: 'posthog:tenant-a' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const request = (path: string, headers?: Record<string, string>) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, { headers }),
		})

	it('fills the tenant slot from the document public capture fields', async () => {
		const res = await request('/analytics/tracker', { 'x-tenant': 'tenant-a' })
		expect(res.status).toBe(200)
		const body = await res.text()
		const config = JSON.parse(body) as TrackerConfig
		const tenant = config.slots.find((s) => s.slot === 'tenant')
		expect(tenant).toMatchObject({
			adapterId: 'posthog:tenant-a',
			kind: 'posthog',
			path: '/api/analytics/p/tenant',
		})
		expect(tenant?.client).toEqual({ kind: 'posthog', token: TOKEN })
		expect(tenant?.snippet.scripts[0]?.inline).toContain(`posthog.init("${TOKEN}"`)
		// The document's query credential must never reach a public response.
		expect(body).not.toContain(SECRET)
	})

	it('omits the tenant slot for a scope with no provider document', async () => {
		const res = await request('/analytics/tracker', { 'x-tenant': 'tenant-b' })
		const config = (await res.json()) as TrackerConfig
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it("proxies the tenant slot to the document's region assets host", async () => {
		const fetched: string[] = []
		server.use(
			http.get(`${EU_ASSETS}/*`, ({ request: upstream }) => {
				fetched.push(upstream.url)
				return new HttpResponse('window.posthog=1', {
					status: 200,
					headers: { 'content-type': 'application/javascript' },
				})
			})
		)
		const res = await request('/analytics/p/tenant/static/array.js', { 'x-tenant': 'tenant-a' })
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('window.posthog=1')
		expect(fetched).toEqual([`${EU_ASSETS}/static/array.js`])
	})
})

/** The GA4 tag is served from Google's own CDN, so the slot has a snippet but no proxy. */
describeForDb('analytics ga4 capture from a provider document', {}, (db) => {
	let booted: BootedPayload

	const ga4Doc = {
		id: 'tenant-g',
		name: 'Tenant GA4',
		provider: 'ga4',
		enabled: true,
		scope: 'tenant-g',
		ga4: {
			propertyId: '123456789',
			clientEmail: 'sa@x.iam.gserviceaccount.com',
			privateKey: 'pk',
			measurementId: MEASUREMENT_ID,
		},
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				providers: {
					resolve: ({ scope }) => {
						const adapter = scope === 'tenant-g' ? adapterFromProviderDoc(ga4Doc) : null
						return adapter ? [adapter] : []
					},
				},
				capture: { slots: { tenant: 'ga4:tenant-g' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const request = (path: string) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, {
				headers: { 'x-tenant': 'tenant-g' },
			}),
		})

	const tenantSlot = async () => {
		const res = await request('/analytics/tracker')
		expect(res.status).toBe(200)
		const config = (await res.json()) as TrackerConfig
		const slot = config.slots.find((s) => s.slot === 'tenant')
		expect(slot).toBeDefined()
		return slot as TrackerConfig['slots'][number]
	}

	it('serves a consent-gated ga4 slot carrying the gtag tag and its inline boot', async () => {
		const slot = await tenantSlot()
		expect(slot.kind).toBe('ga4')
		expect(slot.requiresConsent).toBe(true)
		expect(slot.client).toEqual({ kind: 'ga4', measurementId: MEASUREMENT_ID })
		expect(slot.snippet.scripts).toEqual([
			{
				inline: `${ga4ExcludeGuard(MEASUREMENT_ID)}window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${MEASUREMENT_ID}")`,
			},
			{ src: `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`, async: true },
		])
	})

	it('404s the slot proxy mount: the tag is loaded from Google, not through us', async () => {
		expect((await request('/analytics/p/tenant/gtag/js')).status).toBe(404)
		expect((await request('/analytics/p/tenant/g/collect')).status).toBe(404)
	})

	it('renders the tag and the boot only once the slot is no longer gated', async () => {
		const slot = await tenantSlot()
		const config: TrackerConfig = {
			slots: [slot],
			autoCapture: {
				scrollDepth: true,
				outboundLinks: true,
				fileDownloads: true,
				goalAttribute: true,
				query: true,
			},
			goals: [],
			ingestPath: '/api/analytics/ingest',
		}
		const gated = renderToStaticMarkup(createElement(AnalyticsScripts, { config }))
		expect(gated).not.toContain('googletagmanager.com')

		const granted = renderToStaticMarkup(
			createElement(AnalyticsScripts, {
				config: { ...config, slots: [{ ...slot, requiresConsent: false }] },
			})
		)
		expect(granted).toContain(`src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"`)
		expect(granted).toContain(`gtag("config","${MEASUREMENT_ID}")`)
		expect(granted.indexOf('ga-disable-')).toBeLessThan(granted.indexOf('gtag('))
	})
})
