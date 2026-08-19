import { NextRequest, type NextResponse } from 'next/server'
import { describe, expect, it } from 'vitest'

import { createAuthScopeProxy } from './proxy'

/**
 * Reads back the request headers a proxy handed downstream. Next encodes them onto the
 * response as `x-middleware-override-headers` plus one `x-middleware-request-*` per
 * name, and that list is the complete set the route handler will see.
 */
const forwardedHeaders = (response: NextResponse) => {
	const names =
		response.headers.get('x-middleware-override-headers')?.split(',').filter(Boolean) ?? []

	return new Headers(
		names.map((name): [string, string] => [
			name,
			response.headers.get(`x-middleware-request-${name}`) ?? '',
		])
	)
}

const run = (
	url: string,
	init?: { headers?: Record<string, string>; proxy?: ReturnType<typeof createAuthScopeProxy> }
) => {
	const proxy = init?.proxy ?? createAuthScopeProxy()
	return forwardedHeaders(proxy(new NextRequest(url, { headers: init?.headers })))
}

describe('createAuthScopeProxy', () => {
	it('stamps the scope it resolved', () => {
		expect(run('https://site.test/admin/collections/pages').get('x-payload-auth-scope')).toBe(
			'admin'
		)
		expect(run('https://site.test/products').get('x-payload-auth-scope')).toBe('frontend')
	})

	it('attributes api calls by referer', () => {
		expect(
			run('https://site.test/api/customers/me', {
				headers: { Referer: 'https://site.test/products' },
			}).get('x-payload-auth-scope')
		).toBe('frontend')
	})

	it('sends no scope at all when the request cannot be attributed', () => {
		const headers = run('https://site.test/api/customers/me')

		expect(headers.has('x-payload-auth-scope')).toBe(false)
	})

	it('drops a scope the client sent itself', () => {
		const headers = run('https://site.test/api/customers/me', {
			headers: { 'x-payload-auth-scope': 'frontend' },
		})

		expect(headers.has('x-payload-auth-scope')).toBe(false)
	})

	it('overwrites a scope the client sent itself when it can attribute the request', () => {
		const headers = run('https://site.test/api/customers/me', {
			headers: {
				Referer: 'https://site.test/admin/collections/pages',
				'x-payload-auth-scope': 'frontend',
			},
		})

		expect(headers.get('x-payload-auth-scope')).toBe('admin')
	})

	it('lets resolveScope answer where the default rule cannot', () => {
		const proxy = createAuthScopeProxy({
			resolveScope: (request) =>
				request.headers.get('x-app-client') === 'storefront' ? 'frontend' : undefined,
		})

		expect(
			run('https://site.test/api/customers/me', {
				headers: { 'x-app-client': 'storefront' },
				proxy,
			}).get('x-payload-auth-scope')
		).toBe('frontend')

		expect(run('https://site.test/api/customers/me', { proxy }).has('x-payload-auth-scope')).toBe(
			false
		)
	})

	it('honours a custom header name', () => {
		const proxy = createAuthScopeProxy({ scopeHeader: 'x-scope' })
		const headers = run('https://site.test/admin', { proxy })

		expect(headers.get('x-scope')).toBe('admin')
		expect(headers.has('x-payload-auth-scope')).toBe(false)
	})
})
