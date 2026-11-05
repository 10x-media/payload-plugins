import { SignJWT } from 'jose'
import {
	type CollectionSlug,
	JWT_AUTH_VERSION,
	type Payload,
	type SanitizedCollectionConfig,
} from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { createIsolatedAuthStrategy } from './strategy'

const SECRET = 'test-secret-value'
const PREVIOUS_SECRET = 'previous-secret-value'
const CUSTOMER_COOKIE = 'payload-customers-token'

const slug = (value: string) => value as CollectionSlug

const authConfig = (overrides: Record<string, unknown> = {}) =>
	({
		cookies: { sameSite: 'Lax', secure: false },
		depth: 0,
		tokenExpiration: 7200,
		useSessions: true,
		verify: false,
		...overrides,
	}) as unknown as SanitizedCollectionConfig['auth']

type FakePayloadArgs = {
	findByID?: Payload['findByID']
	disableLocalStrategy?: boolean
	jwtOrder?: ('Bearer' | 'cookie' | 'JWT')[]
	useAPIKey?: boolean
	useSessions?: boolean
	verify?: boolean
}

/**
 * Minimal stand-in for the parts of `payload` the strategy touches. Typed as `Payload`
 * at the boundary because the strategy only reads a handful of properties.
 */
const createFakePayload = ({
	disableLocalStrategy = false,
	findByID,
	jwtOrder = ['JWT', 'Bearer', 'cookie'],
	useAPIKey = false,
	useSessions = true,
	verify = false,
}: FakePayloadArgs = {}) =>
	({
		collections: {
			customers: {
				config: { auth: authConfig({ disableLocalStrategy, useAPIKey, useSessions, verify }) },
			},
		},
		config: {
			admin: { user: 'users' },
			auth: { jwtOrder },
			cookiePrefix: 'payload',
			csrf: [],
		},
		// Payload 4 verifies tokens against every key in the keyring (active, then previous).
		encryptionKeyring: { all: [{ legacyKey: SECRET }, { legacyKey: PREVIOUS_SECRET }] },
		findByID: findByID ?? (async () => null),
		secret: SECRET,
	}) as unknown as Payload

const signToken = (
	claims: Record<string, unknown>,
	{
		authVersion = JWT_AUTH_VERSION,
		secret = SECRET,
	}: { authVersion?: number; secret?: string } = {}
) =>
	new SignJWT(claims)
		.setProtectedHeader({ alg: 'HS256', authVersion })
		.setExpirationTime('2h')
		.sign(new TextEncoder().encode(secret))

const headersWithCookies = (cookies: Record<string, string>) =>
	new Headers({
		Cookie: Object.entries(cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join('; '),
	})

describe('createIsolatedAuthStrategy', () => {
	const strategy = createIsolatedAuthStrategy({
		adminSessionPriority: true,
		cookieName: CUSTOMER_COOKIE,
		higherPriority: [],
		scopeHeader: 'x-payload-auth-scope',
		scopes: ['frontend'],
		slug: slug('customers'),
	})

	const customer = { id: 'customer-1', sessions: [{ id: 'session-1' }] }
	const findCustomer = (async () => structuredClone(customer)) as unknown as Payload['findByID']

	const validToken = () =>
		signToken({ collection: 'customers', id: 'customer-1', sid: 'session-1' })

	it('ignores requests that do not carry its cookie', async () => {
		const result = await strategy.authenticate({
			headers: headersWithCookies({ 'payload-token': 'anything' }),
			payload: createFakePayload(),
		})

		expect(result.user).toBeNull()
	})

	it('authenticates a valid isolated token', async () => {
		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toMatchObject({
			_sid: 'session-1',
			_strategy: 'customers-dual-session',
			collection: 'customers',
			id: 'customer-1',
		})
	})

	it('rejects a token minted for a different collection', async () => {
		const token = await signToken({ collection: 'users', id: 'customer-1', sid: 'session-1' })

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('rejects a token whose session has been revoked', async () => {
		const token = await signToken({ collection: 'customers', id: 'customer-1', sid: 'gone' })

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('rejects a token signed with the wrong secret', async () => {
		const token = await signToken(
			{ collection: 'customers', id: 'customer-1', sid: 'session-1' },
			{ secret: 'a-different-secret' }
		)

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('accepts a token signed with a previous secret, as core does during a rotation', async () => {
		const token = await signToken(
			{ collection: 'customers', id: 'customer-1', sid: 'session-1' },
			{ secret: PREVIOUS_SECRET }
		)

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toMatchObject({ id: 'customer-1' })
	})

	it('rejects a token without Payload’s auth version in its header', async () => {
		const token = await new SignJWT({ collection: 'customers', id: 'customer-1', sid: 'session-1' })
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime('2h')
			.sign(new TextEncoder().encode(SECRET))

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('rejects a token whose id is not a string or number', async () => {
		const token = await signToken({ collection: 'customers', id: { $ne: null }, sid: 'session-1' })

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('rejects every token when the collection disables the local strategy', async () => {
		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() }),
			payload: createFakePayload({ disableLocalStrategy: true, findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
	})

	it('reads the user past access control, in the request locale, and leaves the request as it was', async () => {
		const findByID = vi.fn(async (args: { req?: { locale?: string } }) => {
			if (args.req) {
				args.req.locale = 'changed-by-the-lookup'
			}
			return structuredClone(customer)
		})
		const req = { fallbackLocale: 'en', locale: 'de', query: { depth: '2' } }

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() }),
			payload: createFakePayload({ findByID: findByID as unknown as Payload['findByID'] }),
			req: req as unknown as Parameters<typeof strategy.authenticate>[0]['req'],
		})

		expect(result.user).toMatchObject({ id: 'customer-1' })
		expect(findByID).toHaveBeenCalledWith(
			expect.objectContaining({ fallbackLocale: 'en', locale: 'de', overrideAccess: true, req })
		)
		expect(req).toEqual({ fallbackLocale: 'en', locale: 'de', query: { depth: '2' } })
	})

	it('rejects an unverified user when the collection requires verification', async () => {
		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() }),
			payload: createFakePayload({ findByID: findCustomer, verify: true }),
		})

		expect(result.user).toBeNull()
	})

	describe('without the scope header', () => {
		it('stands down while a live admin session is present', async () => {
			const adminToken = await signToken({ collection: 'users', id: 'admin-1' })

			const result = await strategy.authenticate({
				headers: headersWithCookies({
					'payload-token': adminToken,
					[CUSTOMER_COOKIE]: await validToken(),
				}),
				payload: createFakePayload({ findByID: findCustomer }),
			})

			expect(result.user).toBeNull()
		})

		it('still authenticates when the shared cookie holds a stale token', async () => {
			const result = await strategy.authenticate({
				headers: headersWithCookies({
					'payload-token': 'not-a-valid-jwt',
					[CUSTOMER_COOKIE]: await validToken(),
				}),
				payload: createFakePayload({ findByID: findCustomer }),
			})

			expect(result.user).toMatchObject({ id: 'customer-1' })
		})
	})

	describe('with the scope header', () => {
		it('authenticates in an allowed scope even alongside an admin session', async () => {
			const adminToken = await signToken({ collection: 'users', id: 'admin-1' })
			const headers = headersWithCookies({
				'payload-token': adminToken,
				[CUSTOMER_COOKIE]: await validToken(),
			})
			headers.set('x-payload-auth-scope', 'frontend')

			const result = await strategy.authenticate({
				headers,
				payload: createFakePayload({ findByID: findCustomer }),
			})

			expect(result.user).toMatchObject({ id: 'customer-1' })
		})

		it('stands down in a disallowed scope, keeping the admin panel reachable', async () => {
			const headers = headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() })
			headers.set('x-payload-auth-scope', 'admin')

			const result = await strategy.authenticate({
				headers,
				payload: createFakePayload({ findByID: findCustomer }),
			})

			expect(result.user).toBeNull()
		})
	})

	describe('priority between isolated collections', () => {
		// Config order is not a meaningful priority, so when a visitor holds several
		// isolated sessions the listed order decides, independently of Payload's chain.
		const lowerPriority = createIsolatedAuthStrategy({
			adminSessionPriority: true,
			cookieName: 'payload-employees-token',
			higherPriority: [{ cookieName: CUSTOMER_COOKIE, slug: slug('customers') }],
			scopeHeader: 'x-payload-auth-scope',
			scopes: ['frontend'],
			slug: slug('employees'),
		})

		const employee = { id: 'employee-1', sessions: [{ id: 'session-e' }] }
		const findEmployee = (async () => structuredClone(employee)) as unknown as Payload['findByID']

		const employeePayload = () => {
			const fake = createFakePayload({ findByID: findEmployee })
			const collections = fake.collections as unknown as Record<string, unknown>
			collections.employees = collections.customers
			return fake
		}

		const employeeToken = () =>
			signToken({ collection: 'employees', id: 'employee-1', sid: 'session-e' })

		it('stands down when a higher-priority isolated session exists', async () => {
			const headers = headersWithCookies({
				'payload-employees-token': await employeeToken(),
				[CUSTOMER_COOKIE]: await validToken(),
			})
			headers.set('x-payload-auth-scope', 'frontend')

			expect(
				(await lowerPriority.authenticate({ headers, payload: employeePayload() })).user
			).toBeNull()
		})

		it('authenticates when no higher-priority session exists', async () => {
			const headers = headersWithCookies({ 'payload-employees-token': await employeeToken() })
			headers.set('x-payload-auth-scope', 'frontend')

			expect(
				(await lowerPriority.authenticate({ headers, payload: employeePayload() })).user
			).toMatchObject({ collection: 'employees', id: 'employee-1' })
		})

		it('ignores a higher-priority cookie that is not a valid session', async () => {
			const headers = headersWithCookies({
				'payload-employees-token': await employeeToken(),
				[CUSTOMER_COOKIE]: 'stale-garbage',
			})
			headers.set('x-payload-auth-scope', 'frontend')

			expect(
				(await lowerPriority.authenticate({ headers, payload: employeePayload() })).user
			).toMatchObject({ id: 'employee-1' })
		})
	})

	describe('precedence against the Authorization header', () => {
		// Core reads the header before the cookie (`jwtOrder`), and this strategy runs ahead
		// of both the api-key and local-jwt strategies, so it has to stand down or isolating
		// a collection would silently invert that order.
		const withHeader = async (
			value: string,
			payload = createFakePayload({ findByID: findCustomer })
		) => {
			const headers = headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() })
			headers.set('Authorization', value)
			return (await strategy.authenticate({ headers, payload })).user
		}

		it('stands down for a JWT header', async () => {
			expect(await withHeader('JWT some-token')).toBeNull()
		})

		it('stands down for a Bearer header', async () => {
			expect(await withHeader('Bearer some-token')).toBeNull()
		})

		it('stands down for an api key issued by this collection', async () => {
			const payload = createFakePayload({ findByID: findCustomer, useAPIKey: true })

			expect(await withHeader('customers API-Key abc123', payload)).toBeNull()
		})

		it('ignores an api key header when the collection has no api keys', async () => {
			expect(await withHeader('customers API-Key abc123')).toMatchObject({ id: 'customer-1' })
		})

		it('ignores a scheme Payload does not extract from', async () => {
			expect(await withHeader('Basic dXNlcjpwYXNz')).toMatchObject({ id: 'customer-1' })
		})

		it('keeps the cookie when the project ranks it above the header', async () => {
			const payload = createFakePayload({ findByID: findCustomer, jwtOrder: ['cookie', 'JWT'] })

			expect(await withHeader('JWT some-token', payload)).toMatchObject({ id: 'customer-1' })
		})

		it('still yields to an api key when the cookie is ranked above the header', async () => {
			const payload = createFakePayload({
				findByID: findCustomer,
				jwtOrder: ['cookie', 'JWT'],
				useAPIKey: true,
			})

			// `jwtOrder` governs `extractJWT` only. API keys are a separate strategy sitting
			// directly behind this one, so reordering it cannot outrank them.
			expect(await withHeader('customers API-Key abc123', payload)).toBeNull()
		})
	})

	it('enforces the same CSRF gate as Payload’s own cookie extraction', async () => {
		const payload = createFakePayload({ findByID: findCustomer })
		payload.config.csrf = ['https://site.test']

		const headers = headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() })
		headers.set('Origin', 'https://evil.test')

		expect((await strategy.authenticate({ headers, payload })).user).toBeNull()

		headers.set('Origin', 'https://site.test')
		expect((await strategy.authenticate({ headers, payload })).user).toMatchObject({
			id: 'customer-1',
		})
	})

	it('falls back to the Referer when a browser sends neither Origin nor Sec-Fetch-Site', async () => {
		const payload = createFakePayload({ findByID: findCustomer })
		payload.config.csrf = ['https://site.test']

		// Browsers leave out Sec-Fetch-Site on plain HTTP to hosts other than localhost.
		const headers = headersWithCookies({ [CUSTOMER_COOKIE]: await validToken() })
		expect((await strategy.authenticate({ headers, payload })).user).toBeNull()

		headers.set('Referer', 'https://evil.test/page')
		expect((await strategy.authenticate({ headers, payload })).user).toBeNull()

		headers.set('Referer', 'not a url')
		expect((await strategy.authenticate({ headers, payload })).user).toBeNull()

		headers.set('Referer', 'https://site.test/account')
		expect((await strategy.authenticate({ headers, payload })).user).toMatchObject({
			id: 'customer-1',
		})

		// A cross-site request carrying an allowed Referer is still refused.
		headers.set('Sec-Fetch-Site', 'cross-site')
		expect((await strategy.authenticate({ headers, payload })).user).toBeNull()
	})
})
