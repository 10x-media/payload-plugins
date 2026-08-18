import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type AuthStrategy,
	type CollectionConfig,
	type CollectionSlug,
	type Endpoint,
	getFieldsToSign,
	jwtSign,
	type Payload,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dualSession, generateIsolatedAuthCookie } from '../../src/index'
import { createRestClient, setCookieNames } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }

const ADMIN_COOKIE = 'payload-token'
const CUSTOMER_COOKIE = 'payload-customers-token'

const slug = (value: string) => value as CollectionSlug

type SessionUser = {
	_sid?: string
	_strategy?: string
	collection: string
	email: string
	id: number | string
	sessions?: { createdAt: string; expiresAt: string; id: string }[]
}

/**
 * Stand-in for a hand-rolled SSO strategy of the shape Payload's docs lead you to: it
 * proves identity from a header, mints the session itself, and hands back a user with
 * `_sid` set. The real thing swaps the header check for an OAuth token exchange; nothing
 * else about its contract with Payload differs.
 */
const ssoStrategy: AuthStrategy = {
	name: 'sso',
	authenticate: async ({ headers, payload }) => {
		const email = headers.get('x-sso-email')

		if (!email) {
			return { user: null }
		}

		const collection = payload.collections.customers
		if (!collection) {
			return { user: null }
		}

		const user = (
			await payload.find({
				collection: slug('customers'),
				limit: 1,
				pagination: false,
				showHiddenFields: true,
				where: { email: { equals: email } },
			})
		).docs[0] as unknown as SessionUser | undefined

		if (!user) {
			return { user: null }
		}

		const sid = crypto.randomUUID()
		const now = new Date()
		const expiresAt = new Date(now.getTime() + collection.config.auth.tokenExpiration * 1000)
		const sessions = [
			...(user.sessions ?? []),
			{ createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), id: sid },
		]

		await payload.db.updateOne({
			id: user.id,
			collection: 'customers',
			data: { sessions },
			req: undefined,
			returning: false,
		})

		return {
			user: {
				...user,
				_sid: sid,
				_strategy: 'sso',
				collection: 'customers',
				sessions,
			},
		} as never
	},
}

/**
 * The half that has to change for isolation to hold. A stock OAuth callback ends with
 * `generatePayloadCookie`, which writes the shared cookie and clobbers the admin session;
 * this one writes the collection's own cookie instead.
 */
const ssoCallback: Endpoint = {
	method: 'get',
	path: '/sso/callback',
	handler: async (req) => {
		const email = new URL(req.url ?? '').searchParams.get('email')

		const { user } = await req.payload.auth({
			headers: new Headers(email ? { 'x-sso-email': email } : {}),
		})

		if (!user) {
			return Response.json({ message: 'auth failed' }, { status: 401 })
		}

		const authenticated = user as unknown as SessionUser
		const collection = req.payload.collections.customers

		if (!collection) {
			return Response.json({ message: 'not registered' }, { status: 500 })
		}

		const { token } = await jwtSign({
			fieldsToSign: getFieldsToSign({
				collectionConfig: collection.config,
				email: authenticated.email,
				sid: authenticated._sid,
				user: user as never,
			}),
			secret: req.payload.secret,
			tokenExpiration: collection.config.auth.tokenExpiration,
		})

		const headers = new Headers()
		headers.append(
			'Set-Cookie',
			generateIsolatedAuthCookie({
				collection: slug('customers'),
				payload: req.payload,
				token: token as string,
			})
		)

		return Response.json({ ok: true }, { headers, status: 200 })
	},
}

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{
		slug: 'customers',
		auth: { strategies: [ssoStrategy] },
		endpoints: [ssoCallback],
		fields: [],
	},
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: slug('users'), data: ADMIN })
	await payload.create({ collection: slug('customers'), data: CUSTOMER })
}

type MeBody = { user: null | { collection: string; email: string } }

describeForDb('dualSession alongside a custom auth strategy', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	const client = () => createRestClient(booted)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({ collections: [slug('customers')] }),
			collections,
			db,
			seed,
			configOverrides: { admin: { user: 'users' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('leaves the custom strategy ahead of the isolated one', () => {
		const names = booted.payload.collections.customers?.config.auth.strategies.map(
			({ name }) => name
		)

		// The plugin appends, so a project's own SSO keeps first refusal on every request.
		expect(names).toEqual(['sso', 'customers-dual-session'])
	})

	it('lets the custom strategy authenticate without a cookie at all', async () => {
		const rest = client()

		const me = await rest.get<MeBody>('/api/customers/me', {
			headers: { 'x-payload-auth-scope': 'frontend', 'x-sso-email': CUSTOMER.email },
		})

		expect(me.body.user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
	})

	describe('a callback that mints its own session', () => {
		it('writes the isolated cookie instead of the shared one', async () => {
			const rest = client()
			const response = await rest.get(
				`/api/customers/sso/callback?email=${encodeURIComponent(CUSTOMER.email)}`
			)

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([CUSTOMER_COOKIE])
		})

		it('produces a session the isolated strategy accepts on later requests', async () => {
			const rest = client()
			await rest.get(`/api/customers/sso/callback?email=${encodeURIComponent(CUSTOMER.email)}`)

			// No SSO header this time: the cookie the callback set has to stand on its own.
			const me = await rest.get<MeBody>('/api/customers/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(me.body.user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
		})

		it('does not disturb a live admin session', async () => {
			const rest = client()
			await rest.post('/api/users/login', { body: ADMIN })
			const adminToken = rest.jar.get(ADMIN_COOKIE)

			await rest.get(`/api/customers/sso/callback?email=${encodeURIComponent(CUSTOMER.email)}`)

			expect(rest.jar.get(ADMIN_COOKIE)).toBe(adminToken)

			const admin = await rest.get<MeBody>('/api/users/me', {
				headers: { 'x-payload-auth-scope': 'admin' },
			})
			expect(admin.body.user).toMatchObject({ collection: 'users', email: ADMIN.email })
		})
	})

	it('refuses to mint a cookie for a collection it does not isolate', () => {
		expect(() =>
			generateIsolatedAuthCookie({
				collection: slug('users'),
				payload: booted.payload,
				token: 'irrelevant',
			})
		).toThrow(/not an isolated collection/)
	})
})
