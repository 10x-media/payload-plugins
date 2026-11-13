import { describe, expect, it, vi } from 'vitest'

import { createAuthScopeMiddleware } from './tanstackStart'

type Result = { request: Request; response: Response }

type Server = (args: {
	handlerType: 'router' | 'serverFn'
	next: () => Result
	request: Request
}) => Promise<Result>

/**
 * Runs the middleware's server function the way TanStack Start does, and returns the request
 * headers Payload's adapter will read afterwards (it reads the request itself), along with
 * the response the middleware hands back.
 */
const call = async (
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
	const downstream: Result = { request, response: new Response('ok') }
	const next = vi.fn(() => downstream)
	const server = (middleware.options as unknown as { server: Server }).server

	const result = await server({ handlerType, next, request })

	expect(next).toHaveBeenCalledOnce()

	return { downstream, headers: request.headers, result }
}

const run = async (url: string, init?: Parameters<typeof call>[1]) =>
	(await call(url, init)).headers

describe('createAuthScopeMiddleware', () => {
	it('stamps the scope into the request it hands on', async () => {
		expect(
			(await run('https://site.test/admin/collections/pages')).get('x-payload-auth-scope')
		).toBe('admin')
		expect((await run('https://site.test/products')).get('x-payload-auth-scope')).toBe('frontend')
	})

	it('attributes server function calls by referer, like REST calls', async () => {
		const scopeFor = async (referer: string) =>
			(
				await run('https://site.test/_serverFn/abc123', {
					handlerType: 'serverFn',
					headers: { Referer: referer, 'Sec-Fetch-Site': 'same-origin' },
				})
			).get('x-payload-auth-scope')

		expect(await scopeFor('https://site.test/admin/collections/pages')).toBe('admin')
		expect(await scopeFor('https://site.test/account')).toBe('frontend')
	})

	it('drops a scope the client sent itself when the request cannot be attributed', async () => {
		const headers = await run('https://site.test/api/customers/me', {
			headers: { 'x-payload-auth-scope': 'admin' },
		})

		expect(headers.has('x-payload-auth-scope')).toBe(false)
	})

	it('takes the same options as the Next.js proxy', async () => {
		const middleware = createAuthScopeMiddleware({
			adminRoute: '/backoffice',
			resolveScope: (request) =>
				request.headers.get('x-app-client') === 'storefront' ? 'frontend' : undefined,
			scopeHeader: 'x-scope',
		})

		expect((await run('https://site.test/backoffice/x', { middleware })).get('x-scope')).toBe(
			'admin'
		)
		expect(
			(
				await run('https://site.test/api/customers/me', {
					headers: { 'x-app-client': 'storefront' },
					middleware,
				})
			).get('x-scope')
		).toBe('frontend')
	})

	it('hands back what the handler returned', async () => {
		const { downstream, result } = await call('https://site.test/products')

		expect(result).toBe(downstream)
	})
})

describe('createAuthScopeMiddleware clearStaleSharedCookie', () => {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
	const jwt = (collection: string) => `${encode({ alg: 'HS256' })}.${encode({ collection })}.sig`

	const middleware = createAuthScopeMiddleware({
		clearStaleSharedCookie: { collections: ['customers'] },
	})

	it('drops a stale isolated token from the request and expires it in the browser', async () => {
		const { headers, result } = await call('https://site.test/admin', {
			headers: { Cookie: `payload-token=${jwt('customers')}; payload-customers-token=x` },
			middleware,
		})

		expect(headers.get('cookie')).toBe('payload-customers-token=x')
		expect(result.response.headers.get('set-cookie')).toBe(
			'payload-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'
		)
		expect(await result.response.text()).toBe('ok')
	})

	it('leaves an admin session in the shared cookie alone', async () => {
		const cookie = `payload-token=${jwt('users')}`
		const { downstream, headers, result } = await call('https://site.test/admin', {
			headers: { Cookie: cookie },
			middleware,
		})

		expect(headers.get('cookie')).toBe(cookie)
		expect(result).toBe(downstream)
	})

	it('does nothing unless it is asked to', async () => {
		const cookie = `payload-token=${jwt('customers')}`
		const { downstream, headers, result } = await call('https://site.test/admin', {
			headers: { Cookie: cookie },
		})

		expect(headers.get('cookie')).toBe(cookie)
		expect(result).toBe(downstream)
	})

	it('follows a custom cookie prefix and domain', async () => {
		const { headers, result } = await call('https://site.test/admin', {
			headers: { Cookie: `shop-token=${jwt('customers')}` },
			middleware: createAuthScopeMiddleware({
				clearStaleSharedCookie: {
					collections: ['customers'],
					cookiePrefix: 'shop',
					domain: 'site.test',
				},
			}),
		})

		expect(headers.has('cookie')).toBe(false)
		expect(result.response.headers.get('set-cookie')).toBe(
			'shop-token=; Domain=site.test; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly'
		)
	})
})
