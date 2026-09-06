import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { handleEndpoints } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import type { CaptureSupport } from '../../src/core/capture'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const ORIGIN = 'http://localhost:3000'
const ASSETS = 'https://assets.vendor.test'
const INGEST = 'https://ingest.vendor.test'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const vendorCapture: CaptureSupport = {
	proxy: {
		routes: [
			{ source: '/static/:p*', upstream: `${ASSETS}/static/:p*` },
			{ source: '/:p*', upstream: `${INGEST}/:p*` },
		],
	},
	snippet: () => ({ scripts: [] }),
	client: { kind: 'posthog' },
}

/** A config adapter that declares capture, so the proxy mounts without a real vendor. */
const vendorAdapter = (id = 'vendor'): AnalyticsAdapter => ({
	...memoryAdapter(),
	id,
	label: id,
	capture: vendorCapture,
})

type Fetched = { url: string; headers: Record<string, string>; body: string }

/** Records every upstream call either vendor host receives, and answers as a script would. */
const recordUpstream = (fetched: Fetched[]) => {
	const record = async ({ request }: { request: Request }) => {
		fetched.push({
			url: request.url,
			headers: Object.fromEntries(request.headers.entries()),
			body: await request.text(),
		})
		return new HttpResponse('window.vendor=1', {
			status: 200,
			headers: {
				'content-type': 'application/javascript',
				'cache-control': 'max-age=60',
				etag: 'W/"v1"',
				'set-cookie': 'vendor_session=leak; Path=/',
				'x-vendor-debug': 'leak',
			},
		})
	}
	return [http.all(`${ASSETS}/*`, record), http.all(`${INGEST}/*`, record)]
}

describeForDb('analytics capture proxy endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [vendorAdapter()], cache: { timeoutMs: 300 } }),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const request = (method: string, path: string, init: RequestInit = {}) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${ORIGIN}/api${path}`, { method, ...init }),
		})

	it('forwards a declared asset route to the declared upstream host', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('GET', '/analytics/p/global/static/array.js')
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('window.vendor=1')
		expect(fetched.map((f) => f.url)).toEqual([`${ASSETS}/static/array.js`])
	})

	it('honors route order: the catch-all does not swallow the asset route', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e')
		expect(fetched[0]?.url).toBe(`${INGEST}/e`)
	})

	it('preserves the query string on the upstream URL', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('GET', '/analytics/p/global/e?ver=1.2&data=aGk%3D')
		expect(res.status).toBe(200)
		expect(fetched[0]?.url).toBe(`${INGEST}/e?ver=1.2&data=aGk%3D`)
	})

	it('passes the response body through byte for byte', async () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
		server.use(
			http.get(`${ASSETS}/static/blob.bin`, () =>
				HttpResponse.arrayBuffer(bytes.buffer as ArrayBuffer, {
					headers: { 'content-type': 'application/octet-stream' },
				})
			)
		)
		const res = await request('GET', '/analytics/p/global/static/blob.bin')
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
	})

	it('forwards the allowlisted request headers', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e', {
			headers: {
				'user-agent': 'agent/1',
				'accept-language': 'de-DE',
				referer: `${ORIGIN}/pricing`,
				origin: ORIGIN,
			},
		})
		expect(fetched[0]?.headers['user-agent']).toBe('agent/1')
		expect(fetched[0]?.headers['accept-language']).toBe('de-DE')
		expect(fetched[0]?.headers.referer).toBe(`${ORIGIN}/pricing`)
		expect(fetched[0]?.headers.origin).toBe(ORIGIN)
	})

	it('never forwards cookies or authorization upstream', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e', {
			headers: {
				cookie: 'payload-token=super-secret; other=1',
				authorization: 'Bearer super-secret',
			},
		})
		// msw's own cookie store replays whatever an earlier response set for this host, so
		// the claim is about the request's credentials specifically, not a bare cookie header.
		expect(fetched[0]?.headers.cookie ?? '').not.toContain('payload-token')
		expect(fetched[0]?.headers.authorization).toBeUndefined()
		expect(JSON.stringify(fetched[0]?.headers)).not.toContain('super-secret')
	})

	it('appends the client IP as X-Forwarded-For', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e', {
			headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
		})
		expect(fetched[0]?.headers['x-forwarded-for']).toBe('9.9.9.9')
	})

	it('sends no X-Forwarded-For when the request carries no client IP', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e')
		expect(fetched[0]?.headers['x-forwarded-for']).toBeUndefined()
	})

	it('strips set-cookie and anything outside the response allowlist', async () => {
		server.use(...recordUpstream([]))
		const res = await request('GET', '/analytics/p/global/e')
		expect(res.headers.getSetCookie()).toEqual([])
		expect(res.headers.get('set-cookie')).toBeNull()
		expect(res.headers.get('x-vendor-debug')).toBeNull()
		expect(res.headers.get('content-type')).toBe('application/javascript')
		expect(res.headers.get('cache-control')).toBe('max-age=60')
		expect(res.headers.get('etag')).toBe('W/"v1"')
	})

	it('forwards a POST body', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('POST', '/analytics/p/global/e', {
			body: JSON.stringify({ event: 'pageview' }),
			headers: { 'content-type': 'application/json' },
		})
		expect(res.status).toBe(200)
		expect(fetched[0]?.body).toBe(JSON.stringify({ event: 'pageview' }))
		expect(fetched[0]?.headers['content-type']).toBe('application/json')
	})

	it('forwards OPTIONS', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('OPTIONS', '/analytics/p/global/e')
		expect(res.status).toBe(200)
		expect(fetched[0]?.url).toBe(`${INGEST}/e`)
	})

	it('405s a method outside GET/POST/OPTIONS without touching the upstream', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		for (const method of ['PUT', 'PATCH', 'DELETE']) {
			const res = await request(method, '/analytics/p/global/e')
			expect(res.status).toBe(405)
			expect(await res.text()).toBe('')
		}
		expect(fetched).toEqual([])
	})

	it('404s an unknown slot with an empty body and no upstream call', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('GET', '/analytics/p/admin/static/array.js')
		expect(res.status).toBe(404)
		expect(await res.text()).toBe('')
		expect(fetched).toEqual([])
	})

	it('404s the tenant slot on an unscoped install', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('GET', '/analytics/p/tenant/static/array.js')
		expect(res.status).toBe(404)
		expect(fetched).toEqual([])
	})

	it('502s an upstream failure without echoing the upstream', async () => {
		server.use(http.get(`${INGEST}/*`, () => HttpResponse.error()))
		const res = await request('GET', '/analytics/p/global/e')
		expect(res.status).toBe(502)
		expect(await res.text()).toBe('')
	})

	it('502s an upstream that outlives the timeout', async () => {
		server.use(
			http.get(`${INGEST}/*`, async () => {
				await delay(2000)
				return HttpResponse.text('too late')
			})
		)
		const res = await request('GET', '/analytics/p/global/e')
		expect(res.status).toBe(502)
		expect(await res.text()).toBe('')
	})

	it('passes an upstream error status through rather than masking it', async () => {
		server.use(http.get(`${INGEST}/*`, () => new HttpResponse('nope', { status: 500 })))
		const res = await request('GET', '/analytics/p/global/e')
		expect(res.status).toBe(500)
	})
})

describeForDb('analytics capture proxy - undeclared paths', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [
					{
						...memoryAdapter(),
						capture: {
							...vendorCapture,
							proxy: { routes: [{ source: '/api/send', upstream: `${INGEST}/api/send` }] },
						},
					},
				],
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
			request: new Request(`${ORIGIN}/api${path}`),
		})

	it('forwards the one declared route', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/global/api/send')
		expect(res.status).toBe(200)
		expect(fetched[0]?.url).toBe(`${INGEST}/api/send`)
	})

	it('404s every path outside the declared routes, with no upstream call at all', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		for (const path of [
			'/analytics/p/global/api/other',
			'/analytics/p/global/api/send/more',
			'/analytics/p/global/static/array.js',
			'/analytics/p/global/e',
		]) {
			const res = await request(path)
			expect(res.status).toBe(404)
			expect(await res.text()).toBe('')
		}
		expect(fetched).toEqual([])
	})
})

describeForDb('analytics capture proxy - tenant slot', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				capture: { slots: { tenant: 'vendor-a' } },
				providers: {
					resolve: ({ scope }) => (scope === 'tenant-a' ? [vendorAdapter('vendor-a')] : []),
				},
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
			request: new Request(`${ORIGIN}/api${path}`, { headers }),
		})

	it("forwards through the scope's own runtime provider", async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/tenant/static/array.js', { 'x-tenant': 'tenant-a' })
		expect(res.status).toBe(200)
		expect(fetched[0]?.url).toBe(`${ASSETS}/static/array.js`)
	})

	it('404s when the request resolves no scope', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/tenant/static/array.js')
		expect(res.status).toBe(404)
		expect(fetched).toEqual([])
	})

	it("404s a scope whose registry does not carry the slot's adapter", async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/tenant/static/array.js', { 'x-tenant': 'tenant-b' })
		expect(res.status).toBe(404)
		expect(fetched).toEqual([])
	})

	it('404s the global slot, which the single config adapter cannot fill without capture', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/global/static/array.js')
		expect(res.status).toBe(404)
		expect(fetched).toEqual([])
	})
})
