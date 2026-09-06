import { describe, expect, it } from 'vitest'
import type { ProxyRoute } from '../core/capture'
import {
	buildDownstreamHeaders,
	buildUpstreamHeaders,
	FORWARDED_REQUEST_HEADERS,
	matchProxyRoute,
	STRIPPED_RESPONSE_HEADERS,
} from './proxyRoutes'

const posthogRoutes: ProxyRoute[] = [
	{ source: '/static/:p*', upstream: 'https://us-assets.i.posthog.com/static/:p*' },
	{ source: '/array/:p*', upstream: 'https://us-assets.i.posthog.com/array/:p*' },
	{ source: '/:p*', upstream: 'https://us.i.posthog.com/:p*' },
]

const plausibleRoutes: ProxyRoute[] = [
	{ source: '/js/:script*', upstream: 'https://plausible.io/js/:script*' },
	{ source: '/api/event', upstream: 'https://plausible.io/api/event' },
]

const href = (routes: ProxyRoute[], path: string) => matchProxyRoute(routes, path)?.upstreamUrl.href

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

	it('preserves a trailing slash, which PostHog capture endpoints require', () => {
		expect(href(posthogRoutes, '/e/')).toBe('https://us.i.posthog.com/e/')
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

	it('keeps a percent-encoded separator inside one segment', () => {
		expect(href(posthogRoutes, '/static/a%2Fb.js')).toBe(
			'https://us-assets.i.posthog.com/static/a%2Fb.js'
		)
	})

	it('cannot be walked out of the upstream origin with traversal segments', () => {
		const url = matchProxyRoute(posthogRoutes, '/static/..%2F..%2Fadmin')?.upstreamUrl
		expect(url?.origin).toBe('https://us-assets.i.posthog.com')
		expect(url?.pathname.startsWith('/static/')).toBe(true)
	})

	it('refuses dot segments rather than letting the upstream path collapse', () => {
		expect(matchProxyRoute(posthogRoutes, '/static/../../admin')).toBeNull()
		expect(matchProxyRoute(posthogRoutes, '/static/./array.js')).toBeNull()
	})

	it('refuses a non-http upstream template', () => {
		expect(matchProxyRoute([{ source: '/:p*', upstream: 'file:///etc/passwd' }], '/x')).toBeNull()
	})

	it('refuses an upstream template that is not an absolute URL', () => {
		expect(matchProxyRoute([{ source: '/:p*', upstream: '/relative/:p*' }], '/x')).toBeNull()
	})

	it('keeps a query string the upstream template declares', () => {
		expect(href([{ source: '/s', upstream: 'https://x.test/s?v=2' }], '/s')).toBe(
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

	it('never trusts the incoming forwarding chain', () => {
		expect(buildUpstreamHeaders(incoming, '9.9.9.9').get('x-forwarded-for')).toBe('9.9.9.9')
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

	it('keeps the cacheable content headers', () => {
		const out = buildDownstreamHeaders(upstream)
		expect(out.get('content-type')).toBe('application/javascript')
		expect(out.get('cache-control')).toBe('max-age=60')
		expect(out.get('etag')).toBe('W/"abc"')
		expect(out.get('last-modified')).toBe('Wed, 21 Oct 2015 07:28:00 GMT')
		expect(out.get('vary')).toBe('accept-encoding')
	})

	it('strips set-cookie', () => {
		expect(buildDownstreamHeaders(upstream).has('set-cookie')).toBe(false)
		for (const name of STRIPPED_RESPONSE_HEADERS) {
			expect(buildDownstreamHeaders(upstream).has(name)).toBe(false)
		}
	})

	it('drops content-encoding and content-length, which no longer describe the decoded body', () => {
		const out = buildDownstreamHeaders(
			new Headers({ 'content-encoding': 'gzip', 'content-length': '31' })
		)
		expect(out.has('content-encoding')).toBe(false)
		expect(out.has('content-length')).toBe(false)
	})

	it('drops everything else the upstream sends', () => {
		const out = buildDownstreamHeaders(upstream)
		expect(out.has('x-upstream-debug')).toBe(false)
		expect(out.has('access-control-allow-origin')).toBe(false)
	})
})
