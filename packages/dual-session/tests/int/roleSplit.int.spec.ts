import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, CollectionSlug, Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dualSession, generateIsolatedAuthCookie, resolveIsolatedCookieName } from '../../src/index'
import { createRestClient, setCookieNames } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password', roles: ['admin'] }
const WRITER = { email: 'writer@10xmedia.de', password: 'password', roles: ['writer'] }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }
const AUDITOR = { email: 'auditor@10xmedia.de', password: 'password' }

const SHARED_COOKIE = 'payload-token'
const STAFF_COOKIE = 'payload-staff-token'
const CUSTOMER_COOKIE = 'payload-customers-token'

const slug = (value: string) => value as CollectionSlug

/** The predicate a role-split project writes: admins stay put, everyone else moves. */
const isolate = (user: TypedUser) => !(user as { roles?: string[] }).roles?.includes('admin')

const collections: CollectionConfig[] = [
	{
		slug: 'staff',
		auth: true,
		fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin', 'writer'] }],
	},
	{ slug: 'customers', auth: true, fields: [] },
	// Neither isolated nor the admin collection: the control every claim about the shared
	// cookie is compared against.
	{ slug: 'auditors', auth: true, fields: [] },
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: slug('staff'), data: ADMIN })
	await payload.create({ collection: slug('staff'), data: WRITER })
	await payload.create({ collection: slug('customers'), data: CUSTOMER })
	await payload.create({ collection: slug('auditors'), data: AUDITOR })
}

type MeBody = { token?: string; user: null | { collection: string; email: string } }
type StaffDoc = { email: string; sessions?: { id: string }[] }

/** A `Set-Cookie` header with the two parts that legitimately differ removed. */
const shape = (raw: string) =>
	raw.replace(/Expires=[^;]+/, 'Expires=<t>').replace(/^payload-token=[^;]*/, 'payload-token=<jwt>')

describeForDb('dualSession splitting one collection by role', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	const client = () => createRestClient(booted)

	const staffSessions = async (email: string) => {
		const found = await booted.payload.find({
			collection: slug('staff'),
			limit: 1,
			pagination: false,
			showHiddenFields: true,
			where: { email: { equals: email } },
		})
		return ((found.docs[0] as unknown as StaffDoc).sessions ?? []).length
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({ collections: [{ slug: slug('staff'), isolate }, slug('customers')] }),
			collections,
			db,
			seed,
			configOverrides: { admin: { user: 'staff' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	describe('the cookie follows the user, not the collection', () => {
		it('leaves an admin of the split collection on the shared cookie', async () => {
			const rest = client()
			const response = await rest.post('/api/staff/login', { body: ADMIN })

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([SHARED_COOKIE])
		})

		it('writes that shared cookie exactly as core does for a collection it never touched', async () => {
			const rest = client()
			const split = await rest.post('/api/staff/login', { body: ADMIN, jar: false })
			const untouched = await rest.post('/api/auditors/login', { body: AUDITOR, jar: false })

			// Without this the comparison below passes on two empty strings, which is exactly
			// the regression it exists to catch.
			expect(split.setCookies[0]).toBeTruthy()
			expect(untouched.setCookies[0]).toBeTruthy()

			// The whole promise of the role-split mode is that the admin half is byte-identical
			// to core's. Only the token and the expiry timestamp may differ.
			expect(shape(split.setCookies[0] ?? '')).toBe(shape(untouched.setCookies[0] ?? ''))
		})

		it('moves a non-admin of the same collection onto the isolated cookie', async () => {
			const rest = client()
			const response = await rest.post('/api/staff/login', { body: WRITER })

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([STAFF_COOKIE])
		})

		it('still isolates every user of a collection listed without a predicate', async () => {
			const rest = client()
			const response = await rest.post('/api/customers/login', { body: CUSTOMER })

			expect(setCookieNames(response)).toEqual([CUSTOMER_COOKIE])
		})
	})

	describe('two documents of one collection, one browser', () => {
		const bothLoggedIn = async () => {
			const rest = client()
			await rest.post('/api/staff/login', { body: ADMIN })
			await rest.post('/api/staff/login', { body: WRITER })
			expect(rest.cookieNames()).toEqual([SHARED_COOKIE, STAFF_COOKIE].sort())
			return rest
		}

		it('answers with the admin under the admin scope and the writer under frontend', async () => {
			const rest = await bothLoggedIn()

			const asAdmin = await rest.get<MeBody>('/api/staff/me', {
				headers: { 'x-payload-auth-scope': 'admin' },
			})
			const asWriter = await rest.get<MeBody>('/api/staff/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(asAdmin.body.user).toMatchObject({ collection: 'staff', email: ADMIN.email })
			expect(asWriter.body.user).toMatchObject({ collection: 'staff', email: WRITER.email })
		})

		it('reports each session its own token, not the other cookie', async () => {
			const rest = await bothLoggedIn()

			const asWriter = await rest.get<MeBody>('/api/staff/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(asWriter.body.token).toBe(rest.jar.get(STAFF_COOKIE))
			expect(asWriter.body.token).not.toBe(rest.jar.get(SHARED_COOKIE))
		})

		it('defers to the live admin session when nothing attributed the request', async () => {
			const rest = await bothLoggedIn()

			// `adminSessionPriority` compares the shared cookie against `admin.user`, which for a
			// role-split collection is this very slug. Same slug, different cookie, no collision.
			const me = await rest.get<MeBody>('/api/staff/me')

			expect(me.body.user).toMatchObject({ email: ADMIN.email })
		})

		it('refreshes the cookie the session came from and leaves the other alone', async () => {
			const rest = await bothLoggedIn()
			const sharedBefore = rest.jar.get(SHARED_COOKIE)

			const response = await rest.post('/api/staff/refresh-token', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([STAFF_COOKIE])
			expect(rest.jar.get(SHARED_COOKIE)).toBe(sharedBefore)
		})

		it('refreshes the admin back into the shared cookie', async () => {
			const rest = await bothLoggedIn()
			const isolatedBefore = rest.jar.get(STAFF_COOKIE)

			const response = await rest.post('/api/staff/refresh-token', {
				headers: { 'x-payload-auth-scope': 'admin' },
			})

			expect(setCookieNames(response)).toEqual([SHARED_COOKIE])
			expect(rest.jar.get(STAFF_COOKIE)).toBe(isolatedBefore)
		})

		it('logs the writer out without touching the admin session', async () => {
			const rest = await bothLoggedIn()

			const response = await rest.post('/api/staff/logout', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([STAFF_COOKIE])
			expect(rest.cookieNames()).toEqual([SHARED_COOKIE])

			const me = await rest.get<MeBody>('/api/staff/me', {
				headers: { 'x-payload-auth-scope': 'admin' },
			})
			expect(me.body.user).toMatchObject({ email: ADMIN.email })
		})

		it('ends only the writer sessions on logout?allSessions=true', async () => {
			const rest = await bothLoggedIn()
			const adminSessionsBefore = await staffSessions(ADMIN.email)

			await rest.post('/api/staff/logout?allSessions=true', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			// Core scopes the wipe with `where: { id: { equals: user.id } }`, so sharing a
			// collection with the admin does not put their sessions in range.
			expect(await staffSessions(WRITER.email)).toBe(0)
			expect(await staffSessions(ADMIN.email)).toBe(adminSessionsBefore)
		})
	})

	describe('the admin half stays core behaviour', () => {
		it('resolves an admin holding only the shared cookie on any scope', async () => {
			const rest = client()
			await rest.post('/api/staff/login', { body: ADMIN })

			const me = await rest.get<MeBody>('/api/staff/me', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			// The admin is on the shared cookie, which core's `local-jwt` reads regardless of
			// scope. An admin browsing the site is still the admin, exactly as before.
			expect(me.body.user).toMatchObject({ email: ADMIN.email })
		})

		it('keeps a lone writer session usable with no admin session present', async () => {
			const rest = client()
			await rest.post('/api/staff/login', { body: WRITER })

			const me = await rest.get<MeBody>('/api/staff/me')

			expect(me.body.user).toMatchObject({ email: WRITER.email })
		})

		it('does not re-run the predicate when reading a session', async () => {
			const rest = client()
			await rest.post('/api/staff/login', { body: ADMIN })
			const adminToken = rest.jar.get(SHARED_COOKIE) ?? ''

			// Deliberate: roles live in the document, not in the token, so re-checking here
			// would buy no security and would log out everyone whose role just changed.
			const me = await rest.get<MeBody>('/api/staff/me', {
				cookie: `${STAFF_COOKIE}=${adminToken}`,
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			expect(me.body.user).toMatchObject({ email: ADMIN.email })
		})
	})

	describe('a role that changes under a live session', () => {
		it('moves the refreshed token to the half the user now belongs to', async () => {
			// Its own user, so promoting it cannot disturb the fixtures other tests share.
			const mover = { email: 'mover@10xmedia.de', password: 'password', roles: ['writer'] }
			const created = await booted.payload.create({ collection: slug('staff'), data: mover })

			const rest = client()
			await rest.post('/api/staff/login', { body: mover })
			expect(rest.cookieNames()).toEqual([STAFF_COOKIE])
			const isolatedBefore = rest.jar.get(STAFF_COOKIE)

			await booted.payload.update({
				collection: slug('staff'),
				id: created.id,
				data: { roles: ['admin'] },
			})

			const response = await rest.post('/api/staff/refresh-token', {
				headers: { 'x-payload-auth-scope': 'frontend' },
			})

			// `refresh-token` asks the predicate about the user it just loaded, and that
			// document now says admin, so the replacement lands in the shared cookie rather
			// than in the one the request authenticated from.
			expect(response.status).toBe(200)
			expect(setCookieNames(response)).toEqual([SHARED_COOKIE])

			// The cookie it moved out of is not expired, so it stays live until its own
			// expiry. Both then name the same user, which is why this is documented rather
			// than relied on as a way to revoke anything.
			expect(rest.jar.get(STAFF_COOKIE)).toBe(isolatedBefore)
		})
	})

	describe('the runtime API, for auth this plugin does not shadow', () => {
		const userNamed = async (email: string) =>
			(
				await booted.payload.find({
					collection: slug('staff'),
					limit: 1,
					pagination: false,
					where: { email: { equals: email } },
				})
			).docs[0] as unknown as TypedUser

		it('refuses to pick a cookie for a split collection without a user', () => {
			// An OAuth callback that forgets this would sign people into whichever half the
			// plugin guessed. Better to stop at the call site than to be silently wrong.
			expect(() =>
				generateIsolatedAuthCookie({
					collection: slug('staff'),
					payload: booted.payload,
					token: 'irrelevant',
				})
			).toThrow(/user has to be passed/)
		})

		it('mints the shared cookie for an admin and the isolated one for a writer', async () => {
			const args = { collection: slug('staff'), payload: booted.payload, token: 'a.b.c' }

			expect(generateIsolatedAuthCookie({ ...args, user: await userNamed(ADMIN.email) })).toContain(
				`${SHARED_COOKIE}=a.b.c`
			)
			expect(
				generateIsolatedAuthCookie({ ...args, user: await userNamed(WRITER.email) })
			).toContain(`${STAFF_COOKIE}=a.b.c`)
		})

		it('still answers without a user for a collection listed without a predicate', () => {
			expect(
				generateIsolatedAuthCookie({
					collection: slug('customers'),
					payload: booted.payload,
					token: 'a.b.c',
				})
			).toContain(`${CUSTOMER_COOKIE}=a.b.c`)
		})

		it('names the cookie a given user logs out of', async () => {
			const args = { collection: slug('staff'), payload: booted.payload }

			expect(resolveIsolatedCookieName({ ...args, user: await userNamed(ADMIN.email) })).toBe(
				SHARED_COOKIE
			)
			expect(resolveIsolatedCookieName({ ...args, user: await userNamed(WRITER.email) })).toBe(
				STAFF_COOKIE
			)
		})

		it('has no name to give for a collection it does not isolate at all', () => {
			expect(
				resolveIsolatedCookieName({ collection: slug('auditors'), payload: booted.payload })
			).toBeUndefined()
		})
	})
})
