import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, CollectionSlug, Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dualSession } from '../../src/index'

const slug = (value: string) => value as CollectionSlug

const SCOPE = 'x-payload-auth-scope'

type Resolved = { collection?: string; email?: string } | null

/**
 * Resolves `req.user` the way every request does: the whole strategy chain, core's
 * `local-jwt` last. Calling one strategy directly would miss exactly the fall-through this
 * suite is about.
 */
const resolveUser = async (
	payload: Payload,
	{
		authorization,
		cookies = {},
		scope,
	}: { authorization?: string; cookies?: Record<string, string>; scope?: 'admin' | 'frontend' }
): Promise<Resolved> => {
	const headers = new Headers()
	const cookie = Object.entries(cookies)
		.map(([name, value]) => `${name}=${value}`)
		.join('; ')

	if (cookie) headers.set('Cookie', cookie)
	if (authorization) headers.set('Authorization', authorization)
	if (scope) headers.set(SCOPE, scope)

	const { user } = await payload.auth({ headers })
	return user as Resolved
}

const login = async (
	payload: Payload,
	collection: string,
	data: { email: string; password: string }
) => {
	const { token } = await payload.login({ collection: slug(collection), data })
	if (!token) throw new Error(`no token for ${data.email}`)
	return token
}

describeForDb(
	'a token of an isolated session left in the shared cookie',
	{ dbs: ['mongo'] },
	(db) => {
		describe('two collections', () => {
			const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
			const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }

			const collections: CollectionConfig[] = [
				{ slug: 'users', auth: true, fields: [] },
				{ slug: 'customers', auth: true, fields: [] },
			]

			let booted: BootedPayload
			let adminToken: string
			let customerToken: string

			beforeAll(async () => {
				booted = await bootPayload({
					plugin: dualSession({ collections: [slug('customers')] }),
					collections,
					db,
					seed: async (payload) => {
						await payload.create({ collection: slug('users'), data: ADMIN })
						await payload.create({ collection: slug('customers'), data: CUSTOMER })
					},
					configOverrides: { admin: { user: 'users' } },
				})
				adminToken = await login(booted.payload, 'users', ADMIN)
				customerToken = await login(booted.payload, 'customers', CUSTOMER)
			})

			afterAll(async () => {
				await booted.stop()
			})

			it.each([
				'admin',
				'frontend',
				undefined,
			] as const)('authenticates nobody from it in scope %s', async (scope) => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-token': customerToken },
					scope,
				})

				expect(user).toBeNull()
			})

			it('still lets the isolated cookie authenticate the frontend', async () => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-customers-token': customerToken, 'payload-token': customerToken },
					scope: 'frontend',
				})

				expect(user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
			})

			it('honours the same token in the Authorization header', async () => {
				const user = await resolveUser(booted.payload, {
					authorization: `JWT ${customerToken}`,
					cookies: { 'payload-token': customerToken },
					scope: 'admin',
				})

				expect(user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
			})

			it.each([
				'admin',
				'frontend',
				undefined,
			] as const)('keeps an admin session in it working in scope %s', async (scope) => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-token': adminToken },
					scope,
				})

				expect(user).toMatchObject({ collection: 'users', email: ADMIN.email })
			})
		})

		describe('one collection split by role', () => {
			const ADMIN = { email: 'admin@10xmedia.de', password: 'password', roles: ['admin'] }
			const WRITER = { email: 'writer@10xmedia.de', password: 'password', roles: ['writer'] }

			const isolate = (user: TypedUser) => !(user as { roles?: string[] }).roles?.includes('admin')

			const collections: CollectionConfig[] = [
				{
					slug: 'staff',
					auth: true,
					fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin', 'writer'] }],
				},
			]

			let booted: BootedPayload
			let adminToken: string
			let writerToken: string

			beforeAll(async () => {
				booted = await bootPayload({
					plugin: dualSession({ collections: [{ slug: slug('staff'), isolate }] }),
					collections,
					db,
					seed: async (payload) => {
						await payload.create({ collection: slug('staff'), data: ADMIN })
						await payload.create({ collection: slug('staff'), data: WRITER })
					},
					configOverrides: { admin: { user: 'staff' } },
				})
				adminToken = await login(booted.payload, 'staff', ADMIN)
				writerToken = await login(booted.payload, 'staff', WRITER)
			})

			afterAll(async () => {
				await booted.stop()
			})

			it.each([
				'admin',
				'frontend',
				undefined,
			] as const)('authenticates nobody from a website user’s token in scope %s', async (scope) => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-token': writerToken },
					scope,
				})

				expect(user).toBeNull()
			})

			it.each([
				'admin',
				'frontend',
				undefined,
			] as const)('keeps an admin of the collection working in scope %s', async (scope) => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-token': adminToken },
					scope,
				})

				expect(user).toMatchObject({ email: ADMIN.email })
			})

			it('honours a website user’s token in the Authorization header', async () => {
				const user = await resolveUser(booted.payload, {
					authorization: `JWT ${writerToken}`,
					cookies: { 'payload-token': writerToken },
					scope: 'admin',
				})

				expect(user).toMatchObject({ email: WRITER.email })
			})

			it('does not mistake the stale token for an admin session when no proxy attributes the request', async () => {
				// Without a scope, a live admin session in the shared cookie makes the isolated cookie
				// stand down. A website user's old token carries the admin collection's claim too, and
				// must not keep their own new session standing down.
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-staff-token': writerToken, 'payload-token': writerToken },
				})

				expect(user).toMatchObject({ email: WRITER.email })
			})

			it('still lets a real admin session outrank the isolated cookie when no proxy attributes the request', async () => {
				const user = await resolveUser(booted.payload, {
					cookies: { 'payload-staff-token': writerToken, 'payload-token': adminToken },
				})

				expect(user).toMatchObject({ email: ADMIN.email })
			})
		})
	}
)
