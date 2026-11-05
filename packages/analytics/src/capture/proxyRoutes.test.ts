import { describe, expect, it } from 'vitest'
import type { ProxyRoute } from '../core/capture'
import {
	buildDownstreamHeaders,
	buildUpstreamHeaders,
	DATA_CACHE_CONTROL,
	DATA_CONTENT_SECURITY_POLICY,
	DATA_FALLBACK_CONTENT_TYPE,
	FORWARDED_REQUEST_HEADERS,
	matchProxyRoute,
	SCRIPT_CONTENT_TYPE,
} from './proxyRoutes'

const posthogRoutes: ProxyRoute[] = [
	{
		source: '/static/:p*',
		upstream: 'https://us-assets.i.posthog.com/static/:p*',
		kind: 'script',
	},
	{ source: '/array/:p*', upstream: 'https://us-assets.i.posthog.com/array/:p*', kind: 'script' },
	{ source: '/:p*', upstream: 'https://us.i.posthog.com/:p*', kind: 'data' },
]

const plausibleRoutes: ProxyRoute[] = [
	{ source: '/js/:script*', upstream: 'https://plausible.io/js/:script*', kind: 'script' },
	{ source: '/api/event', upstream: 'https://plausible.io/api/event', kind: 'data' },
]

const href = (routes: ProxyRoute[], path: string, trailingSlashes?: boolean) =>
	matchProxyRoute(routes, path, { trailingSlashes })?.upstreamUrl.href

describe('matchProxyRoute', () => {
	it('maps a single wildcard segment onto the upstream template', () => {
		expect(href(posthogRoutes, '/static/array.js')).toBe(
			'https://us-assets.i.posthog.com/static/array.js'
		)
	})

	it('maps a multi-segment wildcard', () => {
		expect(href(posthogRoutes, '/static/recorder/v2/recorder.js')).toBe(
			'https://us-assets.i.posthog.com/static/recorder/v2/recorder.js'
		)
	})

	it('honors route order: the catch-all only sees what earlier routes miss', () => {
		expect(href(posthogRoutes, '/array/tok/config.js')).toBe(
			'https://us-assets.i.posthog.com/array/tok/config.js'
		)
		expect(href(posthogRoutes, '/e')).toBe('https://us.i.posthog.com/e')
	})

	it('answers with the kind of the route that matched', () => {
		expect(matchProxyRoute(posthogRoutes, '/static/array.js')?.kind).toBe('script')
		expect(matchProxyRoute(posthogRoutes, '/e/')?.kind).toBe('data')
		expect(matchProxyRoute(plausibleRoutes, '/api/event')?.kind).toBe('data')
	})

	it('preserves a trailing slash when the descriptor declares trailingSlashes', () => {
		expect(href(posthogRoutes, '/e/', true)).toBe('https://us.i.posthog.com/e/')
		expect(href(posthogRoutes, '/static/x/', true)).toBe(
			'https://us-assets.i.posthog.com/static/x/'
		)
	})

	it('normalizes a trailing slash away when the descriptor does not declare it', () => {
		expect(href(posthogRoutes, '/e/')).toBe('https://us.i.posthog.com/e')
		expect(href(plausibleRoutes, '/api/event/')).toBe('https://plausible.io/api/event')
	})

	it('matches both slash forms under either setting', () => {
		expect(href(plausibleRoutes, '/api/event', true)).toBe('https://plausible.io/api/event')
		expect(href(plausibleRoutes, '/api/event/', true)).toBe('https://plausible.io/api/event/')
		expect(href(plausibleRoutes, '/api/event')).toBe('https://plausible.io/api/event')
	})

	it('leaves a bare mount alone rather than inventing a slash-only path', () => {
		expect(href(posthogRoutes, '/', true)).toBe('https://us.i.posthog.com/')
	})

	it('matches the bare mount against a catch-all route', () => {
		expect(href(posthogRoutes, '/')).toBe('https://us.i.posthog.com/')
	})

	it('matches a literal route with no params', () => {
		expect(href(plausibleRoutes, '/api/event')).toBe('https://plausible.io/api/event')
	})

	it('returns null when nothing matches', () => {
		expect(matchProxyRoute(plausibleRoutes, '/etc/passwd')).toBeNull()
		expect(matchProxyRoute(plausibleRoutes, '/api/event/extra')).toBeNull()
		expect(matchProxyRoute([], '/anything')).toBeNull()
	})

	it('leaves legal path characters unescaped so a vendor URL round-trips', () => {
		expect(href(posthogRoutes, '/static/a,b=c+d@e:f$g&h.js')).toBe(
			'https://us-assets.i.posthog.com/static/a,b=c+d@e:f$g&h.js'
		)
	})

	it('keeps a semicolon escaped, which some upstreams read as a matrix param', () => {
		expect(href(posthogRoutes, '/static/a;jsessionid=1.js')).toBe(
			'https://us-assets.i.posthog.com/static/a%3Bjsessionid=1.js'
		)
	})

	// An upstream that decodes `%2F` or `%5C` before routing reads either as a separator.
	it('refuses an encoded slash or backslash inside a segment, which could leave the prefix', () => {
		for (const path of [
			'/static/a%2Fb.js',
			'/static/..%2F..%2Fapi%2Fprojects',
			'/static/..%5C..%5Capi%5Cprojects',
			'/static/%2e%2e%2f%2e%2e%2fsignup',
			'/js/pa-x%2F..%2F..%2Fapi.js',
		]) {
			expect(matchProxyRoute([...posthogRoutes, ...plausibleRoutes], path)).toBeNull()
		}
	})

	it('refuses dot segments rather than letting the upstream path collapse', () => {
		expect(matchProxyRoute(posthogRoutes, '/static/../../admin')).toBeNull()
		expect(matchProxyRoute(posthogRoutes, '/static/./array.js')).toBeNull()
	})

	it('skips a route whose upstream names a param the source never produces', () => {
		const routes: ProxyRoute[] = [
			{ source: '/js/:script*', upstream: 'https://x.test/js/:missing', kind: 'script' },
			{ source: '/js/:script*', upstream: 'https://y.test/js/:script*', kind: 'script' },
		]
		expect(href(routes, '/js/a.js')).toBe('https://y.test/js/a.js')
	})

	it('returns null rather than throwing when every route fails to compile', () => {
		expect(
			matchProxyRoute(
				[{ source: '/js/:script*', upstream: 'https://x.test/js/:missing', kind: 'script' }],
				'/js/a.js'
			)
		).toBeNull()
	})

	it('refuses a non-http upstream template', () => {
		expect(
			matchProxyRoute([{ source: '/:p*', upstream: 'file:///etc/passwd', kind: 'data' }], '/x')
		).toBeNull()
	})

	it('refuses an upstream template that is not an absolute URL', () => {
		expect(
			matchProxyRoute([{ source: '/:p*', upstream: '/relative/:p*', kind: 'data' }], '/x')
		).toBeNull()
	})

	it('keeps a query string the upstream template declares', () => {
		expect(href([{ source: '/s', upstream: 'https://x.test/s?v=2', kind: 'data' }], '/s')).toBe(
			'https://x.test/s?v=2'
		)
	})
})

describe('buildUpstreamHeaders', () => {
	const incoming = new Headers({
		'content-type': 'text/plain',
		accept: '*/*',
		'accept-encoding': 'gzip',
		'accept-language': 'de',
		'user-agent': 'agent/1',
		origin: 'https://site.test',
		referer: 'https://site.test/page',
		cookie: 'payload-token=secret',
		authorization: 'Bearer secret',
		host: 'site.test',
		'x-forwarded-for': '1.2.3.4',
		'x-custom': 'nope',
	})

	it('forwards exactly the allowlisted headers', () => {
		const out = buildUpstreamHeaders(incoming, null)
		for (const name of FORWARDED_REQUEST_HEADERS) {
			expect(out.get(name)).toBe(incoming.get(name))
		}
	})

	it('never forwards cookie, authorization or host', () => {
		const out = buildUpstreamHeaders(incoming, '1.2.3.4')
		expect(out.has('cookie')).toBe(false)
		expect(out.has('authorization')).toBe(false)
		expect(out.has('host')).toBe(false)
	})

	it('drops anything outside the allowlist', () => {
		expect(buildUpstreamHeaders(incoming, null).has('x-custom')).toBe(false)
	})

	it('sets X-Forwarded-For from the resolved client ip', () => {
		expect(buildUpstreamHeaders(incoming, '9.9.9.9').get('x-forwarded-for')).toBe('9.9.9.9')
	})

	it('sends no X-Forwarded-For rather than a fabricated one', () => {
		expect(buildUpstreamHeaders(incoming, null).has('x-forwarded-for')).toBe(false)
		expect(buildUpstreamHeaders(incoming, '').has('x-forwarded-for')).toBe(false)
	})

	it('relays no platform header about the visitor, even one a descriptor asks for', () => {
		const platform = new Headers({
			'x-real-ip': '1.1.1.1',
			'cf-connecting-ip': '2.2.2.2',
			'cf-ipcountry': 'KP',
			'x-vercel-ip-country': 'KP',
			'x-vercel-forwarded-for': '3.3.3.3',
			'true-client-ip': '4.4.4.4',
		})
		const out = buildUpstreamHeaders(platform, '9.9.9.9', [...platform.keys()])
		expect([...out.keys()]).toEqual(['x-forwarded-for'])
		expect(out.get('x-forwarded-for')).toBe('9.9.9.9')
	})

	it('never passes the incoming forwarding chain through', () => {
		const out = buildUpstreamHeaders(incoming, null)
		expect(out.get('x-forwarded-for')).toBeNull()
		expect(JSON.stringify([...out])).not.toContain('1.2.3.4')
	})

	it('forwards the conditional headers so proxied assets can revalidate', () => {
		const out = buildUpstreamHeaders(
			new Headers({
				'if-none-match': 'W/"abc"',
				'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
			}),
			null
		)
		expect(out.get('if-none-match')).toBe('W/"abc"')
		expect(out.get('if-modified-since')).toBe('Wed, 21 Oct 2015 07:28:00 GMT')
	})

	it('forwards vendor-specific extras a descriptor declares', () => {
		const out = buildUpstreamHeaders(new Headers({ 'x-vendor': 'v' }), null, ['x-vendor'])
		expect(out.get('x-vendor')).toBe('v')
	})

	it('refuses an extra that would leak credentials or spoof the chain', () => {
		const out = buildUpstreamHeaders(incoming, '9.9.9.9', ['cookie', 'authorization', 'host'])
		expect(out.has('cookie')).toBe(false)
		expect(out.has('authorization')).toBe(false)
		expect(out.has('host')).toBe(false)
	})

	it('omits an allowlisted header the request does not carry', () => {
		expect(buildUpstreamHeaders(new Headers({ accept: '*/*' }), null).has('user-agent')).toBe(false)
	})
})

describe('buildDownstreamHeaders', () => {
	const upstream = new Headers({
		'content-type': 'application/javascript',
		'cache-control': 'max-age=60',
		etag: 'W/"abc"',
		'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
		vary: 'accept-encoding',
		'set-cookie': 'ph_session=1; Path=/',
		'access-control-allow-origin': '*',
		'x-upstream-debug': 'leak',
	})

	const typed = (contentType?: string) =>
		new Headers(contentType === undefined ? {} : { 'content-type': contentType })

	it('keeps the cacheable headers on a script route', () => {
		const out = buildDownstreamHeaders(upstream, 'script')
		expect(out.get('cache-control')).toBe('max-age=60')
		expect(out.get('etag')).toBe('W/"abc"')
		expect(out.get('last-modified')).toBe('Wed, 21 Oct 2015 07:28:00 GMT')
		expect(out.get('vary')).toBe('accept-encoding')
	})

	it('answers a data route private and uncacheable, with no validator, whatever the vendor sent', () => {
		const out = buildDownstreamHeaders(upstream, 'data')
		expect(out.get('cache-control')).toBe(DATA_CACHE_CONTROL)
		expect(DATA_CACHE_CONTROL).toBe('private, no-store')
		expect(out.has('etag')).toBe(false)
		expect(out.has('last-modified')).toBe(false)
		expect(buildDownstreamHeaders(new Headers(), 'data').get('cache-control')).toBe(
			'private, no-store'
		)
	})

	it('strips set-cookie on both kinds', () => {
		for (const kind of ['script', 'data'] as const) {
			expect(buildDownstreamHeaders(upstream, kind).has('set-cookie')).toBe(false)
			expect(buildDownstreamHeaders(upstream, kind).getSetCookie()).toEqual([])
		}
	})

	it('drops content-encoding and content-length, which no longer describe the decoded body', () => {
		const out = buildDownstreamHeaders(
			new Headers({ 'content-encoding': 'gzip', 'content-length': '31' }),
			'data'
		)
		expect(out.has('content-encoding')).toBe(false)
		expect(out.has('content-length')).toBe(false)
	})

	it('drops everything else the upstream sends', () => {
		const out = buildDownstreamHeaders(upstream, 'data')
		expect(out.has('x-upstream-debug')).toBe(false)
		expect(out.has('access-control-allow-origin')).toBe(false)
	})

	it('serves a script route as JavaScript whatever the vendor labelled it', () => {
		for (const sent of ['application/javascript', 'text/html', 'image/svg+xml', undefined]) {
			const out = buildDownstreamHeaders(typed(sent), 'script')
			expect(out.get('content-type')).toBe(SCRIPT_CONTENT_TYPE)
			expect(out.get('x-content-type-options')).toBe('nosniff')
			expect(out.has('content-security-policy')).toBe(false)
		}
	})

	it('passes JSON and plain text through on a data route', () => {
		expect(
			buildDownstreamHeaders(typed('application/json; charset=utf-8'), 'data').get('content-type')
		).toBe('application/json; charset=utf-8')
		expect(buildDownstreamHeaders(typed('Text/Plain'), 'data').get('content-type')).toBe(
			'Text/Plain'
		)
	})

	it('serves anything else a data route answers as sandboxed plain text, never sniffed', () => {
		for (const sent of ['text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'text/xml']) {
			const out = buildDownstreamHeaders(typed(sent), 'data')
			expect(out.get('content-type')).toBe(DATA_FALLBACK_CONTENT_TYPE)
			expect(out.get('x-content-type-options')).toBe('nosniff')
			expect(out.get('content-security-policy')).toBe(DATA_CONTENT_SECURITY_POLICY)
		}
		expect(buildDownstreamHeaders(typed(), 'data').get('content-type')).toBe(
			DATA_FALLBACK_CONTENT_TYPE
		)
	})

	it('sandboxes every data answer, a JSON one included', () => {
		const out = buildDownstreamHeaders(typed('application/json'), 'data')
		expect(out.get('content-security-policy')).toBe("sandbox; default-src 'none'")
		expect(out.get('x-content-type-options')).toBe('nosniff')
	})
})
