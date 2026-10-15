import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { HttpResponse, http } from 'msw'
import { handleEndpoints } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { ga4ExcludeGuard } from '../../src/adapters/ga4/disableKey'
import { posthog } from '../../src/adapters/posthog/posthog'
import type { FetchLike } from '../../src/core/fetch'
import type { ProvidersResolveArgs } from '../../src/core/options'
import { HostRefusedError } from '../../src/core/sourceErrors'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { adapterFromProviderDoc } from '../../src/providers/factory'
import { resolveHostPolicy } from '../../src/providers/hosts'
import { AnalyticsScripts } from '../../src/site/AnalyticsScripts'
import type { TrackerConfig } from '../../src/tracker/config'
import { setupServer } from './msw'

const SECRET = 'phx_private_query_key'
const TOKEN = 'phc_tenant_public'
const EU_ASSETS = 'https://eu-assets.i.posthog.com'
const MEASUREMENT_ID = 'G-AB12CD34'
const SELF_HOSTED = 'https://posthog.example.com'

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

/**
 * msw intercepts the global fetch, which the guarded one is not: these specs hand the document's
 * adapter the global fetch so the vendor answers from the stubs, and check the guarded one apart.
 */
const viaStubs: FetchLike = (input, init) => fetch(input, init)

// A document's adapter carries its instance id (provider:docId), which is what the tenant
// slot names; the config adapter stays the default, so the slot has to be explicit.
describeForDb('analytics capture from a provider document', {}, (db) => {
	let booted: BootedPayload
	const handed: ProvidersResolveArgs[] = []

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				providers: {
					hosts: { allow: [SELF_HOSTED] },
					resolve: (args) => {
						handed.push(args)
						const adapter =
							args.scope === 'tenant-a'
								? adapterFromProviderDoc(tenantDoc, { ...args, fetch: viaStubs })
								: null
						return adapter ? [adapter] : []
					},
				},
				capture: { gate: ({ kind }) => kind !== 'native', slots: { tenant: 'posthog:tenant-a' } },
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
		const res = await request('/_x/config', { 'x-tenant': 'tenant-a' })
		expect(res.status).toBe(200)
		const body = await res.text()
		const config = JSON.parse(body) as TrackerConfig
		const tenant = config.slots.find((s) => s.slot === 'tenant')
		expect(tenant).toMatchObject({
			adapterId: 'posthog:tenant-a',
			kind: 'posthog',
			path: '/api/_x/p/tenant',
		})
		expect(tenant?.client).toEqual({ kind: 'posthog', token: TOKEN })
		expect(tenant?.snippet.scripts[0]?.inline).toContain(`posthog.init("${TOKEN}"`)
		// The document's query credential must never reach a public response.
		expect(body).not.toContain(SECRET)
	})

	it("hands providers.resolve the runtime's guarded fetch and the install's providers.hosts", async () => {
		await request('/_x/config', { 'x-tenant': 'tenant-a' })
		const args = handed.at(-1)
		expect(args?.hosts).toEqual(resolveHostPolicy({ allow: [SELF_HOSTED] }))
		expect(args?.sdks).toEqual({})
		await expect(args?.fetch('https://127.0.0.1/collect')).rejects.toBeInstanceOf(HostRefusedError)
	})

	it('omits the tenant slot for a scope with no provider document', async () => {
		const res = await request('/_x/config', { 'x-tenant': 'tenant-b' })
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
		const res = await request('/_x/p/tenant/static/array.js', { 'x-tenant': 'tenant-a' })
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
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				providers: {
					resolve: (args) => {
						const adapter = args.scope === 'tenant-g' ? adapterFromProviderDoc(ga4Doc, args) : null
						return adapter ? [adapter] : []
					},
				},
				capture: { gate: ({ kind }) => kind !== 'native', slots: { tenant: 'ga4:tenant-g' } },
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
		const res = await request('/_x/config')
		expect(res.status).toBe(200)
		const config = (await res.json()) as TrackerConfig
		const slot = config.slots.find((s) => s.slot === 'tenant')
		expect(slot).toBeDefined()
		return slot as TrackerConfig['slots'][number]
	}

	it('serves a gated ga4 slot carrying the gtag tag and its inline boot', async () => {
		const slot = await tenantSlot()
		expect(slot.kind).toBe('ga4')
		expect(slot.gated).toBe(true)
		expect(slot.client).toEqual({ kind: 'ga4', measurementId: MEASUREMENT_ID })
		expect(slot.snippet.scripts).toEqual([
			{
				inline: `${ga4ExcludeGuard(MEASUREMENT_ID)}window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${MEASUREMENT_ID}")`,
			},
			{ src: `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`, async: true },
		])
	})

	it('404s the slot proxy mount: the tag is loaded from Google, not through us', async () => {
		expect((await request('/_x/p/tenant/gtag/js')).status).toBe(404)
		expect((await request('/_x/p/tenant/g/collect')).status).toBe(404)
	})

	it('renders the tag and the boot only for a slot ungated or opened on the server', async () => {
		const slot = await tenantSlot()
		const config: TrackerConfig = {
			slots: [slot],
			autoCapture: {
				scrollDepth: true,
				outboundLinks: true,
				fileDownloads: true,
				goalAttribute: true,
				query: true,
				items: { impressions: true, clicks: true, pages: true },
			},
			goals: [],
			ingestPath: '/api/_x/e',
		}
		const gated = renderToStaticMarkup(createElement(AnalyticsScripts, { config }))
		expect(gated).not.toContain('googletagmanager.com')

		const granted = renderToStaticMarkup(
			createElement(AnalyticsScripts, {
				config: { ...config, slots: [{ ...slot, gated: false }] },
			})
		)
		expect(granted).toContain(`src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"`)
		expect(granted).toContain(`gtag("config","${MEASUREMENT_ID}")`)
		expect(granted.indexOf('ga-disable-')).toBeLessThan(granted.indexOf('gtag('))

		const opened = renderToStaticMarkup(
			createElement(AnalyticsScripts, { config, gate: { tenant: true } })
		)
		expect(opened).toContain(`src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"`)
	})
})

/**
 * The platform's PostHog fills the global slot and a tenant's PostHog document the tenant slot:
 * posthog-js runs the tenant's as a named client, so one page captures into both projects.
 */
describeForDb('analytics with a platform and a tenant PostHog', {}, (db) => {
	let booted: BootedPayload
	const US_INGEST = 'https://us.i.posthog.com'
	const EU_INGEST = 'https://eu.i.posthog.com'

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [
					posthog({ projectId: '1', apiKey: 'phx_platform', projectToken: 'phc_platform' }),
				],
				platformAdapter: 'posthog',
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				providers: {
					resolve: (args) => {
						const adapter =
							args.scope === 'tenant-a'
								? adapterFromProviderDoc(tenantDoc, { ...args, fetch: viaStubs })
								: null
						return adapter ? [adapter] : []
					},
				},
				capture: { gate: 'off', slots: { tenant: 'posthog:tenant-a' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const request = (path: string, init?: { method?: string; body?: string }) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, {
				...init,
				headers: { 'x-tenant': 'tenant-a' },
			}),
		})

	it('fills both slots, the tenant one on the named client "tenant"', async () => {
		const res = await request('/_x/config')
		const config = (await res.json()) as TrackerConfig
		expect(config.slots.map((s) => [s.slot, s.adapterId, s.kind, s.instance])).toEqual([
			['global', 'posthog', 'posthog', undefined],
			['tenant', 'posthog:tenant-a', 'posthog', 'tenant'],
		])
		const tenant = config.slots[1]?.snippet.scripts.at(-1)?.inline
		expect(tenant).toContain(`posthog.init("${TOKEN}",{api_host:"/api/_x/p/tenant"`)
		expect(tenant).toContain('},"tenant")')
	})

	it("relays each slot's events to its own project's ingest", async () => {
		const upstream: string[] = []
		const record = ({ request: relayed }: { request: Request }) => {
			upstream.push(relayed.url)
			return HttpResponse.json({ status: 1 })
		}
		server.use(http.post(`${US_INGEST}/*`, record), http.post(`${EU_INGEST}/*`, record))
		const body = JSON.stringify({ event: 'signup' })

		expect((await request('/_x/p/global/e/', { method: 'POST', body })).status).toBe(200)
		expect((await request('/_x/p/tenant/e/', { method: 'POST', body })).status).toBe(200)
		expect(upstream).toEqual([`${US_INGEST}/e/`, `${EU_INGEST}/e/`])
	})
})
