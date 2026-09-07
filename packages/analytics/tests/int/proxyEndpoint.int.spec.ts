import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { handleEndpoints } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { posthog } from '../../src/adapters/posthog/posthog'
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
			plugin: analytics({
				adapters: [vendorAdapter()],
				capture: { proxy: { timeoutMs: 300, maxBodyBytes: 1024 } },
			}),
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

	it('answers OPTIONS locally rather than forwarding a preflight', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('OPTIONS', '/analytics/p/global/e')
		expect(res.status).toBe(204)
		expect(res.headers.get('allow')).toBe('GET, POST, OPTIONS')
		expect(await res.text()).toBe('')
		expect(fetched).toEqual([])
	})

	it('413s a body over the cap without forwarding any of it', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('POST', '/analytics/p/global/e', {
			body: 'x'.repeat(2048),
			headers: { 'content-type': 'text/plain' },
		})
		expect(res.status).toBe(413)
		expect(await res.text()).toBe('')
		expect(fetched).toEqual([])
	})

	it('413s an oversize chunked body, which declares no content-length', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(600).fill(65))
				controller.enqueue(new Uint8Array(600).fill(65))
				controller.close()
			},
		})
		const res = await request('POST', '/analytics/p/global/e', {
			body: stream,
			headers: { 'content-type': 'text/plain' },
			// @ts-expect-error duplex is required for a stream body and absent from lib.dom
			duplex: 'half',
		})
		expect(res.status).toBe(413)
		expect(fetched).toEqual([])
	})

	it('400s a body that dies in transit, rather than surfacing a 500', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(10).fill(65))
			},
			pull(controller) {
				controller.error(new Error('client went away'))
			},
		})
		const res = await request('POST', '/analytics/p/global/e', {
			body: stream,
			headers: { 'content-type': 'text/plain' },
			// @ts-expect-error duplex is required for a stream body and absent from lib.dom
			duplex: 'half',
		})
		expect(res.status).toBe(400)
		expect(await res.text()).toBe('')
		expect(fetched).toEqual([])
	})

	it('forwards a body just under the cap', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const payload = 'x'.repeat(1000)
		const res = await request('POST', '/analytics/p/global/e', {
			body: payload,
			headers: { 'content-type': 'text/plain' },
		})
		expect(res.status).toBe(200)
		expect(fetched[0]?.body).toBe(payload)
	})

	it('passes a 304 through with its etag, so proxied assets revalidate', async () => {
		const fetched: Fetched[] = []
		server.use(
			http.get(`${ASSETS}/static/array.js`, ({ request }) => {
				fetched.push({ url: request.url, headers: {}, body: '' })
				expect(request.headers.get('if-none-match')).toBe('W/"v1"')
				return new HttpResponse(null, { status: 304, headers: { etag: 'W/"v1"' } })
			})
		)
		const res = await request('GET', '/analytics/p/global/static/array.js', {
			headers: { 'if-none-match': 'W/"v1"' },
		})
		expect(res.status).toBe(304)
		expect(res.headers.get('etag')).toBe('W/"v1"')
		expect(fetched).toHaveLength(1)
	})

	it('streams a body that outlives the timeout, because the deadline is time-to-headers', async () => {
		server.use(
			http.get(`${ASSETS}/static/slow.js`, () => {
				const stream = new ReadableStream<Uint8Array>({
					async start(controller) {
						controller.enqueue(new TextEncoder().encode('head;'))
						await delay(900)
						controller.enqueue(new TextEncoder().encode('tail;'))
						controller.close()
					},
				})
				return new HttpResponse(stream, {
					status: 200,
					headers: { 'content-type': 'application/javascript' },
				})
			})
		)
		const res = await request('GET', '/analytics/p/global/static/slow.js')
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('head;tail;')
	})

	it('keeps a path character path-to-regexp would otherwise escape', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/static/a,b=c+d@e.js')
		expect(fetched[0]?.url).toBe(`${ASSETS}/static/a,b=c+d@e.js`)
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

	it('normalizes a trailing slash away when the descriptor does not ask for it', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		await request('GET', '/analytics/p/global/e/')
		expect(fetched[0]?.url).toBe(`${INGEST}/e`)
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
							proxy: {
								trailingSlashes: true,
								routes: [{ source: '/api/send', upstream: `${INGEST}/api/send` }],
							},
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

	it("keeps the trailing slash the descriptor's trailingSlashes flag asks for", async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		const res = await request('/analytics/p/global/api/send/')
		expect(res.status).toBe(200)
		expect(fetched[0]?.url).toBe(`${INGEST}/api/send/`)
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

// A dashboard-only PostHog install carries the private query key and nothing public, so it
// must not get a public forward proxy to PostHog's ingest hosts.
describeForDb('analytics capture proxy - read-only PostHog install', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	// The vendor adapter mounts the proxy; the global slot names the read-only PostHog one,
	// so the route exists and the slot is what has to refuse it.
	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [vendorAdapter(), posthog({ projectId: '123', apiKey: 'phx_private' })],
				capture: { slots: { global: 'posthog' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('404s every proxy path for the global slot', async () => {
		const fetched: Fetched[] = []
		server.use(...recordUpstream(fetched))
		for (const path of ['/analytics/p/global/static/array.js', '/analytics/p/global/e']) {
			const res = await handleEndpoints({
				config: booted.payload.config,
				payloadInstanceCacheKey: booted.cacheKey,
				request: new Request(`${ORIGIN}/api${path}`),
			})
			expect(res.status).toBe(404)
			expect(await res.text()).toBe('')
		}
		expect(fetched).toEqual([])
	})
})
