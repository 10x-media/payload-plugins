import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { exclusionPrelude, withExclusionPrelude } from '../capture/exclusionPrelude'
import type { CaptureSnippet } from './config'
import { EXCLUSION_STASH_KEY } from './exclusion'
import { createScriptLoader } from './loadScript'
import { createGa4Sink } from './sinks/ga4'
import { createPlausibleSink } from './sinks/plausible'
import { createPosthogSink } from './sinks/posthog'
import type { TrackerWindow } from './types'

/**
 * A sink dispatches only once the vendor global exists, so a snippet whose inline init throws
 * before its loader lands publishes none: only running the snippets in a DOM catches that.
 */

type PosthogStub = unknown[] & {
	capture?: (name: string, props?: unknown) => void
	_i?: unknown[]
	tenant?: PosthogStub
}

interface VendorRealm {
	dataLayer?: unknown[]
	gtag?: (...args: unknown[]) => void
	posthog?: PosthogStub
	plausible?: ((name: string, options?: unknown) => void) & {
		q?: unknown[]
		o?: { endpoint?: string }
		init?: (options?: unknown) => void
	}
}

/**
 * Snippets run in jsdom's own realm, handed out through the shared document. It outlives a test,
 * so its vendor globals are cleared before each one: an already installed stub does nothing.
 */
const bridgeRealm = (): VendorRealm => {
	const bridge = document.createElement('script')
	bridge.text = 'document.__realm = window'
	document.head.appendChild(bridge)
	return (document as unknown as { __realm: VendorRealm }).__realm
}

let realm: VendorRealm

const runSnippet = async (snippet: CaptureSnippet, nonce?: string) => {
	const load = createScriptLoader(window, nonce)
	for (const script of snippet.scripts) {
		const pending = load(script)
		if (script.src) {
			// jsdom fetches nothing; stand in for the vendor bundle arriving.
			const el = [...document.head.querySelectorAll('script')].find(
				(candidate) => candidate.getAttribute('src') === script.src
			)
			el?.dispatchEvent(new Event('load'))
		}
		await pending
	}
}

const scriptSources = (): Array<string | null> =>
	[...document.querySelectorAll('script')].map((el) => el.getAttribute('src'))

/** Attribute selectors do not match elements the script realm created, so scan instead. */
const scriptWithSrc = (src: string): Element | undefined =>
	[...document.querySelectorAll('script')].find((el) => el.getAttribute('src') === src)

const sinkArgs = (realm: VendorRealm) => ({
	slot: 'tenant' as const,
	win: realm as unknown as TrackerWindow,
	scripts: [],
	loadScript: () => Promise.resolve(),
})

beforeEach(() => {
	document.head.innerHTML = ''
	realm = bridgeRealm()
	realm.posthog = undefined
	realm.plausible = undefined
	realm.dataLayer = undefined
	realm.gtag = undefined
})

describe('posthog snippet', () => {
	const snippet = () =>
		posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' }).capture?.snippet(
			{ path: '/api/_x/p/tenant' }
		) ?? { scripts: [] }

	it('publishes a callable stub and injects array.js off the proxy path', async () => {
		await runSnippet(snippet())

		expect(typeof realm.posthog?.capture).toBe('function')
		expect(scriptSources()).toContain('/api/_x/p/tenant/static/array.js')
		expect(realm.posthog?._i?.[0]).toEqual([
			'phc_public',
			{
				api_host: '/api/_x/p/tenant',
				ui_host: 'https://us.posthog.com',
				capture_pageview: 'history_change',
				opt_out_persistence_by_default: true,
			},
			'posthog',
		])
	})

	it('carries the CSP nonce of the inline onto the script it injects', async () => {
		await runSnippet(snippet(), 'n0nce')

		expect(scriptWithSrc('/api/_x/p/tenant/static/array.js')?.getAttribute('nonce')).toBe('n0nce')
	})

	it('injects no nonce when the inline carries none', async () => {
		await runSnippet(snippet())

		expect(scriptWithSrc('/api/_x/p/tenant/static/array.js')?.hasAttribute('nonce')).toBe(false)
	})

	it('queues a sink dispatch made before the SDK lands', async () => {
		await runSnippet(snippet())

		createPosthogSink(sinkArgs(realm)).send({
			type: 'event',
			name: 'signup',
			path: '/',
			hostname: 'shop.test',
		})

		expect([...(realm.posthog ?? [])]).toContainEqual(['capture', 'signup', {}])
	})
})

describe('a platform and a tenant PostHog on one page', () => {
	const platform = () =>
		posthog({ projectId: '1', apiKey: 'phx_a', projectToken: 'phc_platform' }).capture?.snippet({
			path: '/api/_x/p/global',
		}) ?? { scripts: [] }
	const tenant = () =>
		posthog({ projectId: '2', apiKey: 'phx_b', projectToken: 'phc_tenant' }).capture?.snippet({
			path: '/api/_x/p/tenant',
			instance: 'tenant',
		}) ?? { scripts: [] }

	const bundles = () => scriptSources().filter((src) => src?.endsWith('/static/array.js'))
	const inits = () => (realm.posthog?._i ?? []).map((entry) => [...(entry as unknown[])])
	const event = { type: 'event' as const, name: 'signup', path: '/', hostname: 'shop.test' }

	it('loads array.js once while it is still loading, and queues each init for its client', async () => {
		await runSnippet(platform())
		await runSnippet(tenant())

		expect(bundles()).toEqual(['/api/_x/p/global/static/array.js'])
		expect(inits().map(([token, , name]) => [token, name])).toEqual([
			['phc_platform', 'posthog'],
			['phc_tenant', 'tenant'],
		])
		expect(typeof realm.posthog?.tenant?.capture).toBe('function')
	})

	it('loads it once when the tenant slot opens first', async () => {
		await runSnippet(tenant())
		await runSnippet(platform())

		expect(bundles()).toEqual(['/api/_x/p/tenant/static/array.js'])
		expect(inits().map(([token, , name]) => [token, name])).toEqual([
			['phc_tenant', 'tenant'],
			['phc_platform', 'posthog'],
		])
	})

	it('inits the named client on a posthog-js already loaded, injecting nothing', async () => {
		const init = vi.fn()
		const loaded = { __loaded: true, init, capture: vi.fn() }
		Reflect.set(realm, 'posthog', loaded)

		await runSnippet(tenant())

		expect(realm.posthog).toBe(loaded)
		expect(loaded.init).toBe(init)
		expect(bundles()).toEqual([])
		expect(init).toHaveBeenCalledTimes(1)
		expect(init.mock.calls[0]?.[0]).toBe('phc_tenant')
		expect(init.mock.calls[0]?.[2]).toBe('tenant')
	})

	it('queues each sink dispatch on its own client', async () => {
		await runSnippet(platform())
		await runSnippet(tenant())

		createPosthogSink({ ...sinkArgs(realm), slot: 'global' }).send(event)
		createPosthogSink({ ...sinkArgs(realm), instance: 'tenant' }).send({ ...event, name: 'buy' })

		const calls = (stub: PosthogStub | undefined) =>
			[...(stub ?? [])].map((call) => [...(call as unknown[])])
		expect(calls(realm.posthog)).toEqual([['capture', 'signup', {}]])
		expect(calls(realm.posthog?.tenant)).toEqual([['capture', 'buy', {}]])
	})
})

describe('plausible per-site snippet', () => {
	const snippet = () =>
		plausible({ siteId: 'example.com', apiKey: 'k', scriptId: 'abc123' }).capture?.snippet({
			path: '/api/_x/p/tenant',
		}) ?? { scripts: [] }

	it('publishes the queue stub and parks the endpoint for the tracker', async () => {
		await runSnippet(snippet())

		expect(typeof realm.plausible).toBe('function')
		expect(realm.plausible?.o).toEqual({ endpoint: '/api/_x/p/tenant/api/event' })
	})

	it('queues a sink dispatch made before the tracker lands', async () => {
		await runSnippet(snippet())

		createPlausibleSink(sinkArgs(realm)).send({
			type: 'goal',
			name: 'checkout',
			path: '/',
			hostname: 'shop.test',
			value: 49,
			currency: 'EUR',
		})

		const queued = [...(realm.plausible?.q ?? [])]
		expect(queued).toHaveLength(1)
		expect([...(queued[0] as unknown as unknown[])]).toEqual([
			'checkout',
			{ revenue: { amount: 49, currency: 'EUR' } },
		])
	})

	it('injects nothing of its own, so the rendered tag keeps its nonce', async () => {
		await runSnippet(snippet(), 'n0nce')

		// Unlike PostHog's, this stub only publishes globals: the loader tag is the only
		// script, and it was nonced where it was created.
		expect(scriptSources().filter(Boolean)).toEqual(['/api/_x/p/tenant/js/pa-abc123.js'])
		expect(scriptWithSrc('/api/_x/p/tenant/js/pa-abc123.js')?.getAttribute('nonce')).toBe('n0nce')
	})

	it('leaves a tracker that won the race against the inline alone', async () => {
		const realInit = () => undefined
		const real = Object.assign(() => undefined, { init: realInit })
		realm.plausible = real as unknown as VendorRealm['plausible']

		await runSnippet(snippet())

		// Loader and inline can arrive in either order, so the stub must never clobber the
		// real tracker or the real init: the endpoint would be lost with it.
		expect(realm.plausible).toBe(real)
		expect(realm.plausible?.init).toBe(realInit)
	})
})

describe('ga4 snippet', () => {
	const snippet = () =>
		ga4({
			propertyId: '1',
			credentials: { client_email: 'sa@x.iam', private_key: 'pk' },
			measurementId: 'G-AB12CD34',
		}).capture?.snippet({ path: '/api/_x/p/tenant' }) ?? { scripts: [] }

	it('loads the tag from googletagmanager and publishes a callable gtag', async () => {
		await runSnippet(snippet())

		expect(scriptSources()).toContain('https://www.googletagmanager.com/gtag/js?id=G-AB12CD34')
		expect(typeof realm.gtag).toBe('function')
		// gtag pushes `arguments`, so the queue holds array-likes rather than arrays.
		const queued = [...(realm.dataLayer ?? [])].map((args) => [...(args as unknown[])])
		expect(queued[0]?.[0]).toBe('js')
		expect(queued[1]).toEqual(['config', 'G-AB12CD34'])
	})

	it('queues a sink dispatch made before the tag lands', async () => {
		await runSnippet(snippet())

		createGa4Sink(sinkArgs(realm)).send({
			type: 'goal',
			name: 'checkout',
			path: '/',
			hostname: 'shop.test',
			value: 49,
			currency: 'EUR',
		})

		const queued = [...(realm.dataLayer ?? [])].map((args) => [...(args as unknown[])])
		expect(queued.at(-1)).toEqual(['event', 'checkout', { value: 49, currency: 'EUR' }])
	})
})

/**
 * Every vendor reads the address as it loads, and a snippet the server rendered runs before the
 * tracker boots: the exclusion link has to be out of the address before the first vendor call.
 */
describe('the exclusion link ahead of a rendered snippet', () => {
	const PARAM = 'analytics_exclude'
	const realmStash = (): unknown => Reflect.get(realm, EXCLUSION_STASH_KEY)

	beforeEach(() => {
		Reflect.deleteProperty(realm, EXCLUSION_STASH_KEY)
		window.history.replaceState(null, '', `/pricing?utm_source=news&${PARAM}=tok3n#top`)
	})

	afterEach(() => {
		window.history.replaceState(null, '', '/')
	})

	it("leaves the address before GA4's config reads it as page_location, keeping the token for the tracker", async () => {
		const seen: string[] = []
		const layer: unknown[] = []
		realm.dataLayer = Object.assign(layer, {
			push: (...entries: unknown[]) => {
				seen.push(document.location.href)
				return Array.prototype.push.apply(layer, entries)
			},
		})
		const ga = ga4({
			propertyId: '1',
			credentials: { client_email: 'sa@x.iam', private_key: 'pk' },
			measurementId: 'G-AB12CD34',
		}).capture?.snippet({ path: '/api/_x/p/global' }) ?? { scripts: [] }

		await runSnippet(withExclusionPrelude(ga, PARAM))

		const queued = layer.map((args) => [...(args as unknown[])])
		expect(queued[1]).toEqual(['config', 'G-AB12CD34'])
		expect(seen).toHaveLength(2)
		for (const href of seen) {
			expect(href).not.toContain(PARAM)
			expect(href).toContain('/pricing?utm_source=news#top')
		}
		expect(realmStash()).toBe('tok3n')
	})

	it('leaves the address before PostHog and Plausible load, and before any later snippet', async () => {
		const ph = posthog({
			projectId: '1',
			apiKey: 'phx_private',
			projectToken: 'phc_public',
		}).capture?.snippet({ path: '/api/_x/p/tenant' }) ?? { scripts: [] }
		const pl = plausible({
			siteId: 'example.com',
			apiKey: 'k',
			domain: 'example.com',
		}).capture?.snippet({ path: '/api/_x/p/global' }) ?? { scripts: [] }

		await runSnippet(withExclusionPrelude(pl, PARAM))
		expect(document.location.search).toBe('?utm_source=news')
		expect(document.location.hash).toBe('#top')
		await runSnippet(withExclusionPrelude(ph, PARAM))

		expect(realmStash()).toBe('tok3n')
		expect(realm.posthog?._i?.[0]).toBeDefined()
		const order = [...document.querySelectorAll('script')].map(
			(el) => el.getAttribute('src') ?? (el.textContent?.includes(PARAM) ? 'prelude' : 'inline')
		)
		expect(order.indexOf('prelude')).toBeLessThan(order.indexOf('/api/_x/p/global/js/script.js'))
	})

	it('leaves an address without the parameter, and the stash, alone', async () => {
		window.history.replaceState(null, '', '/pricing?utm_source=news')
		await runSnippet({ scripts: [{ inline: exclusionPrelude(PARAM) }] })

		expect(document.location.search).toBe('?utm_source=news')
		expect(realmStash()).toBeUndefined()
	})
})
