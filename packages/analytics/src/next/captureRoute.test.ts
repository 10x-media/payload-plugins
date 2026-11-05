import { describe, expect, it, vi } from 'vitest'
import type { CaptureSupport } from '../core/capture'
import type { AnalyticsAdapter } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { captureRoute } from './captureRoute'

const ASSETS = 'https://assets.vendor.test'
const INGEST = 'https://ingest.vendor.test'

/** A vendor adapter whose relay fetches through `fetch`, as a provider-built one does. */
const vendorWith = (fetch: CaptureSupport['proxy']['fetch']): AnalyticsAdapter => ({
	...memoryAdapter(),
	id: 'vendor',
	capture: {
		proxy: {
			routes: [
				{ source: '/static/:p*', upstream: `${ASSETS}/static/:p*`, kind: 'script' },
				{ source: '/:p*', upstream: `${INGEST}/:p*`, kind: 'data' },
			],
			fetch,
		},
		snippet: () => ({ scripts: [] }),
		client: { kind: 'posthog' },
	},
})

type Fetched = { url: string; headers: Headers; body: string | null }

const recording = () => {
	const fetched: Fetched[] = []
	const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
		const body = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : null
		fetched.push({ url: String(url), headers: new Headers(init?.headers), body })
		return new Response('window.vendor=1', {
			status: 200,
			headers: {
				'content-type': 'application/javascript',
				'set-cookie': 'vendor_session=leak; Path=/',
				'cache-control': 'max-age=60',
			},
		})
	})
	return { fetched, fetch }
}

const SITE = 'https://site.example'

/** Sends one request of the site's to `handler`. */
const call =
	(handler: (request: Request) => Promise<Response>) =>
	(method: string, path: string, init: RequestInit = {}) =>
		handler(new Request(`${SITE}${path}`, { method, ...init }))

describe('captureRoute', () => {
	it("relays a declared route without the visitor's cookies or the site's credentials, and no set-cookie back", async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({ path: '/ph', adapter: vendorWith(fetch), trustedProxyHops: 1 })

		const res = await call(handler)('GET', '/ph/static/array.js?v=2', {
			headers: {
				cookie: 'payload-token=secret; session=s',
				authorization: 'Bearer secret',
				'user-agent': 'UA',
				'x-forwarded-for': '1.2.3.4, 10.0.0.1',
			},
		})

		expect(res.status).toBe(200)
		expect(res.headers.get('set-cookie')).toBeNull()
		expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
		expect(await res.text()).toBe('window.vendor=1')
		expect(fetched[0]?.url).toBe(`${ASSETS}/static/array.js?v=2`)
		expect(fetched[0]?.headers.get('cookie')).toBeNull()
		expect(fetched[0]?.headers.get('authorization')).toBeNull()
		expect(fetched[0]?.headers.get('user-agent')).toBe('UA')
		expect(fetched[0]?.headers.get('x-forwarded-for')).toBe('10.0.0.1')
	})

	it('relays a POST to a data route, and refuses one to a script route', async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({ path: '/ph', adapter: vendorWith(fetch) })

		expect((await call(handler)('POST', '/ph/e', { body: '{"event":"x"}' })).status).toBe(200)
		const script = await call(handler)('POST', '/ph/static/array.js', { body: 'x' })

		expect(script.status).toBe(405)
		expect(script.headers.get('allow')).toBe('GET, OPTIONS')
		expect(fetched.map((each) => [each.url, each.body])).toEqual([[`${INGEST}/e`, '{"event":"x"}']])
	})

	it('404s a path outside the mount or one walking out of a route, with no upstream call', async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({ path: '/ph', adapter: vendorWith(fetch) })

		for (const path of [
			'/other/static/a.js',
			'/phx/e',
			'/ph/static/..%2F..%2Fadmin',
			'/ph/static/%5C..',
		]) {
			expect((await call(handler)('GET', path)).status).toBe(404)
		}
		expect(fetched).toEqual([])
	})

	it('finds its mount below a Next basePath', async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({ path: '/ph', adapter: vendorWith(fetch) })

		expect((await call(handler)('GET', '/blog/ph/static/a.js')).status).toBe(200)
		expect(fetched[0]?.url).toBe(`${ASSETS}/static/a.js`)
	})

	it("refuses another site's POST unless allowedOrigins lists it, and answers OPTIONS itself", async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({
			path: '/ph',
			adapter: vendorWith(fetch),
			allowedOrigins: ['https://partner.example'],
		})
		const from = (origin: string) =>
			call(handler)('POST', '/ph/e', {
				body: '{}',
				headers: { 'sec-fetch-site': 'cross-site', origin },
			})

		expect((await from('https://evil.example')).status).toBe(403)
		expect((await from('https://partner.example')).status).toBe(200)
		expect((await call(handler)('OPTIONS', '/ph/e')).status).toBe(204)
		expect((await call(handler)('PUT', '/ph/e')).status).toBe(405)
		expect(fetched).toHaveLength(1)
	})

	it('413s a body over its cap before relaying any of it', async () => {
		const { fetched, fetch } = recording()
		const handler = captureRoute({ path: '/ph', adapter: vendorWith(fetch), maxBodyBytes: 8 })

		expect((await call(handler)('POST', '/ph/e', { body: 'x'.repeat(64) })).status).toBe(413)
		expect(fetched).toEqual([])
	})

	it('refuses a setup it cannot relay safely, when it is built', () => {
		const { fetch } = recording()
		expect(() => captureRoute({ path: '/', adapter: vendorWith(fetch) })).toThrow(/site root/)
		expect(() => captureRoute({ path: '/ph', adapter: memoryAdapter() })).toThrow(/proxy routes/)
		expect(() =>
			captureRoute({
				path: '/ph',
				adapter: vendorWith(fetch),
				trustedProxyHops: 1,
				trustedPlatform: 'vercel',
			})
		).toThrow(/not both/)
		expect(() =>
			captureRoute({ path: '/ph', adapter: vendorWith(fetch), allowedOrigins: ['https://*.x'] })
		).toThrow(/allowedOrigins/)
	})
})
