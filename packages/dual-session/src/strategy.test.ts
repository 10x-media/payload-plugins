import { SignJWT } from 'jose'
import type { CollectionSlug, Payload, SanitizedCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { createIsolatedAuthStrategy } from './strategy'

const SECRET = 'test-secret-value'
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
	useSessions?: boolean
	verify?: boolean
}

/**
 * Minimal stand-in for the parts of `payload` the strategy touches. Typed as `Payload`
 * at the boundary because the strategy only reads a handful of properties.
 */
const createFakePayload = ({
	findByID,
	useSessions = true,
	verify = false,
}: FakePayloadArgs = {}) =>
	({
		collections: {
			customers: { config: { auth: authConfig({ useSessions, verify }) } },
		},
		config: {
			admin: { user: 'users' },
			cookiePrefix: 'payload',
			csrf: [],
		},
		findByID: findByID ?? (async () => null),
		secret: SECRET,
	}) as unknown as Payload

const signToken = (claims: Record<string, unknown>) =>
	new SignJWT(claims)
		.setProtectedHeader({ alg: 'HS256' })
		.setExpirationTime('2h')
		.sign(new TextEncoder().encode(SECRET))

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
		const token = await new SignJWT({ collection: 'customers', id: 'customer-1', sid: 'session-1' })
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime('2h')
			.sign(new TextEncoder().encode('a-different-secret'))

		const result = await strategy.authenticate({
			headers: headersWithCookies({ [CUSTOMER_COOKIE]: token }),
			payload: createFakePayload({ findByID: findCustomer }),
		})

		expect(result.user).toBeNull()
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
		// isolated sessions the listed order decides — independently of Payload's chain.
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
})
