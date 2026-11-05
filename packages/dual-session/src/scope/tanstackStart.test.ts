import { describe, expect, it, vi } from 'vitest'

import { createAuthScopeMiddleware } from './tanstackStart'

type Server = (args: {
	handlerType: 'router' | 'serverFn'
	next: () => unknown
	request: Request
}) => unknown

/**
 * Runs the middleware's server function the way TanStack Start does, and returns the request
 * headers Payload's adapter will read afterwards (it reads the request itself).
 */
const run = (
	url: string,
	{
		handlerType = 'router',
		headers,
		middleware = createAuthScopeMiddleware(),
	}: {
		handlerType?: 'router' | 'serverFn'
		headers?: Record<string, string>
		middleware?: ReturnType<typeof createAuthScopeMiddleware>
	} = {}
) => {
	const request = new Request(url, { headers })
	const next = vi.fn(() => 'next-result')
	const server = (middleware.options as unknown as { server: Server }).server

	const result = server({ handlerType, next, request })

	expect(next).toHaveBeenCalledOnce()
	expect(result).toBe('next-result')

	return request.headers
}

describe('createAuthScopeMiddleware', () => {
	it('stamps the scope into the request it hands on', () => {
		expect(run('https://site.test/admin/collections/pages').get('x-payload-auth-scope')).toBe(
			'admin'
		)
		expect(run('https://site.test/products').get('x-payload-auth-scope')).toBe('frontend')
	})

	it('attributes server function calls by referer, like REST calls', () => {
		const call = (referer: string) =>
			run('https://site.test/_serverFn/abc123', {
				handlerType: 'serverFn',
				headers: { Referer: referer, 'Sec-Fetch-Site': 'same-origin' },
			}).get('x-payload-auth-scope')

		expect(call('https://site.test/admin/collections/pages')).toBe('admin')
		expect(call('https://site.test/account')).toBe('frontend')
	})

	it('drops a scope the client sent itself when the request cannot be attributed', () => {
		const headers = run('https://site.test/api/customers/me', {
			headers: { 'x-payload-auth-scope': 'admin' },
		})

		expect(headers.has('x-payload-auth-scope')).toBe(false)
	})

	it('takes the same options as the Next.js proxy', () => {
		const middleware = createAuthScopeMiddleware({
			adminRoute: '/backoffice',
			resolveScope: (request) =>
				request.headers.get('x-app-client') === 'storefront' ? 'frontend' : undefined,
			scopeHeader: 'x-scope',
		})

		expect(run('https://site.test/backoffice/x', { middleware }).get('x-scope')).toBe('admin')
		expect(
			run('https://site.test/api/customers/me', {
				headers: { 'x-app-client': 'storefront' },
				middleware,
			}).get('x-scope')
		).toBe('frontend')
	})
})
