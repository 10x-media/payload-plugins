import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, CollectionSlug, Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dualSession } from '../../src/index'
import { createRestClient, setCookieNames } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }
const PARTNER = { email: 'partner@10xmedia.de', password: 'password' }
const MEMBER = { email: 'member@10xmedia.de', password: 'password' }
const KIOSK = { email: 'kiosk@10xmedia.de', password: 'password' }

const ADMIN_COOKIE = 'payload-token'
const CUSTOMER_COOKIE = 'payload-customers-token'
const PARTNER_COOKIE = 'partner-session'

const slug = (value: string) => value as CollectionSlug

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'partners', auth: true, fields: [] },
	{
		slug: 'customers',
		auth: true,
		endpoints: [
			{
				method: 'get',
				path: '/ping',
				handler: (req) => Response.json({ collection: req.user?.collection ?? null, pong: true }),
			},
		],
		fields: [],
	},
	{ slug: 'members', auth: { verify: true }, fields: [] },
	{ slug: 'kiosks', auth: { useSessions: false }, fields: [] },
	// Isolated, but local login is off: the shadows must behave exactly like the built-ins
	// they replace, which is to refuse.
	{
		slug: 'machines',
		auth: { disableLocalStrategy: true },
		fields: [{ name: 'label', type: 'text' }],
	},
	// Not isolated. The control the `machines` assertions are compared against.
	{
		slug: 'robots',
		auth: { disableLocalStrategy: true },
		fields: [{ name: 'label', type: 'text' }],
	},
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: slug('users'), data: ADMIN })
	await payload.create({ collection: slug('customers'), data: CUSTOMER })
	await payload.create({ collection: slug('partners'), data: PARTNER })
	await payload.create({
		collection: slug('members'),
		data: { ...MEMBER, _verified: true },
		disableVerificationEmail: true,
	})
	await payload.create({ collection: slug('kiosks'), data: KIOSK })
}

type MeBody = { token?: string; user: null | { collection: string; email: string } }

describeForDb('dualSession over the real REST router', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	const client = () => createRestClient(booted)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({
				// Order is priority: a visitor holding both resolves as the partner.
				collections: [
					{ slug: slug('partners'), cookieName: PARTNER_COOKIE },
					slug('customers'),
					slug('members'),
					slug('kiosks'),
					slug('machines'),
				],
			}),
			collections,
			db,
			seed,
			configOverrides: { admin: { user: 'users' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	describe('cookie isolation', () => {
		it('writes only the isolated cookie when a frontend collection logs in', async () => {
			const rest = client()
			const response = await rest.post('/api/customers/login', { body: CUSTOMER })

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([CUSTOMER_COOKIE])
			expect(response.setCookies[0]).toContain('HttpOnly')
		})

		it('leaves the admin collection on the shared cookie', async () => {
			const rest = client()
			const response = await rest.post('/api/users/login', { body: ADMIN })

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([ADMIN_COOKIE])
		})

		it('honours a per-collection cookie name override', async () => {
			const rest = client()
			const response = await rest.post('/api/partners/login', { body: PARTNER })

			expect(setCookieNames(response)).toEqual([PARTNER_COOKIE])
		})
	})

	describe('two live sessions at once', () => {
		it('resolves each collection against its own cookie', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })

			expect(rest.cookieNames()).toEqual([ADMIN_COOKIE, CUSTOMER_COOKIE].sort())

			const asCustomer = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})
			const asAdmin = await rest.get<MeBody>('/api/users/me', {
				headers: { 'x-payload-auth-scope': 'admin' },
			})

			expect(asCustomer.body.user).toMatchObject({
				collection: 'customers',
				email: CUSTOMER.email,
			})
			expect(asAdmin.body.user).toMatchObject({ collection: 'users', email: ADMIN.email })
		})

		it('keeps the admin panel reachable when no proxy stamped a scope', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })

			// `adminSessionPriority` defaults on: an unattributed call must not let the
			// frontend session shadow the live admin one.
			const me = await rest.get<MeBody>('/api/customers/me')

			expect(me.body.user).toBeNull()
		})

		it('never authenticates a frontend collection from the shared cookie', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })

			const me = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(me.body.user).toBeNull()
		})

		it('yields to an Authorization header, as core does', async () => {
			const rest = client()
			const login = await rest.post<{ token?: string }>('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })

			const headers = {
				Authorization: `JWT ${login.body.token}`,
				'x-payload-auth-scope': 'frontend',
			}

			// Core's `jwtOrder` puts the header ahead of the cookie. The isolated strategy runs
			// before both the api-key and local-jwt strategies, so it has to stand down or
			// isolation would silently invert that order.
			const asCustomer = await rest.get<MeBody>('/api/customers/me', { headers })
			expect(asCustomer.body.user).toBeNull()

			const asAdmin = await rest.get<MeBody>('/api/users/me', { headers })
			expect(asAdmin.body.user).toMatchObject({ collection: 'users', email: ADMIN.email })
		})

		it('ranks isolated collections by the order they are listed, not config order', async () => {
			const rest = client()
			await rest.post('/api/customers/login', { body: CUSTOMER })
			await rest.post('/api/partners/login', { body: PARTNER })

			const asCustomer = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			// `partners` is listed first, so it outranks the customer session.
			expect(asCustomer.body.user).toBeNull()
		})
	})

	describe('the shadowed endpoints', () => {
		it('logs out by expiring only its own cookie', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })

			const response = await rest.post('/api/customers/logout', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([CUSTOMER_COOKIE])
			expect(rest.cookieNames()).toEqual([ADMIN_COOKIE])
		})

		it('refreshes into the isolated cookie, leaving the admin session alone', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })
			const adminToken = rest.jar.get(ADMIN_COOKIE)

			const response = await rest.post<{ refreshedToken?: string }>(
				'/api/customers/refresh-token',
				{ headers: { 'x-payload-auth-scope': 'frontend' } }
			)

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([CUSTOMER_COOKIE])
			// Core re-signs the same claims, so within a second the string can be identical to
			// the one login issued. What matters is which cookie it lands in.
			expect(response.body.refreshedToken).toBe(rest.jar.get(CUSTOMER_COOKIE))
			expect(rest.jar.get(ADMIN_COOKIE)).toBe(adminToken)

			const me = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})
			expect(me.body.user).toMatchObject({ email: CUSTOMER.email })
		})

		it('reports the isolated token back from /me, not the admin one', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			await rest.post('/api/customers/login', { body: CUSTOMER })

			const me = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(me.body.token).toBe(rest.jar.get(CUSTOMER_COOKIE))
			expect(me.body.token).not.toBe(rest.jar.get(ADMIN_COOKIE))
		})

		it('reports the header token when the request carried no cookie', async () => {
			const rest = client()
			const login = await rest.post<{ token?: string }>('/api/customers/login', {
				body: CUSTOMER,
			})

			// A non-browser client: bearer token, no cookie at all. Core's `/me` answers with
			// the token it authenticated from, so the shadow has to as well.
			const me = await rest.get<MeBody>('/api/customers/me', {
				headers: { Authorization: `JWT ${login.body.token}` },
				jar: false,
			})

			expect(me.body.user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
			expect(me.body.token).toBe(login.body.token)
		})

		it('leaves the collection own endpoints routable', async () => {
			const rest = client()
			await rest.post('/api/customers/login', { body: CUSTOMER })

			const ping = await rest.get<{ collection: null | string; pong: boolean }>(
				'/api/customers/ping',
				{ headers: { 'x-payload-auth-scope': 'frontend' } }
			)

			expect(ping.body).toEqual({ collection: 'customers', pong: true })
		})

		it('still serves the endpoints it does not shadow', async () => {
			const rest = client()
			const response = await rest.post('/api/customers/forgot-password', {
				body: { email: 'nobody@10xmedia.de' },
			})

			// Core answers 200 for an unknown address rather than leaking existence.
			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([])
		})
	})

	describe('auth config variants', () => {
		it('authenticates a collection that requires email verification', async () => {
			const rest = client()
			const login = await rest.post('/api/members/login', { body: MEMBER })
			expect(login.status).toBe(200)

			const me = await rest.get<MeBody>('/api/members/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			// `_verified` and `sessions` are read back through a plain findByID, exactly as
			// core's JWT strategy does. If either were stripped, this resolves to no user.
			expect(me.body.user).toMatchObject({ collection: 'members', email: MEMBER.email })
		})

		it('authenticates a collection with sessions disabled', async () => {
			const rest = client()
			await rest.post('/api/kiosks/login', { body: KIOSK })

			const me = await rest.get<MeBody>('/api/kiosks/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(me.body.user).toMatchObject({ collection: 'kiosks', email: KIOSK.email })
		})

		it('refuses local login exactly like the built-in it shadows', async () => {
			const rest = client()

			const isolated = await rest.post('/api/machines/login', {
				body: { email: 'a@b.c', password: 'x' },
			})
			const control = await rest.post('/api/robots/login', {
				body: { email: 'a@b.c', password: 'x' },
			})

			// Core registers these endpoints regardless of `disableLocalStrategy` and lets the
			// operation refuse, so the shadow must land on the same status, not a 500.
			expect(isolated.status).toBe(control.status)
			expect(isolated.status).toBe(403)
			expect(setCookieNames(isolated)).toEqual([])
		})
	})
})
