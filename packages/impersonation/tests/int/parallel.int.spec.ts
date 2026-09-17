import { dualSession } from '@10x-media/dual-session'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { impersonation } from '../../src/index'
import { createRestClient } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const PARTNER = { email: 'partner@10xmedia.de', password: 'password' }
const STAFF = { email: 'staff@10xmedia.de', password: 'password', roles: ['admin'] }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password', roles: ['customer'] }

const isolatedCollections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }] },
	{ slug: 'partners', auth: true, fields: [{ name: 'name', type: 'text' }] },
]

const roleSplitCollections: CollectionConfig[] = [
	{
		slug: 'users',
		auth: true,
		fields: [
			{ name: 'name', type: 'text' },
			{
				hasMany: true,
				name: 'roles',
				options: ['admin', 'customer'],
				type: 'select',
			},
		],
	},
]

const seedIsolated = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: { ...ADMIN, name: 'Admin' } })
	await payload.create({ collection: 'partners', data: { ...PARTNER, name: 'Partner' } })
}

const seedRoleSplit = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: { ...STAFF, name: 'Staff' } })
	await payload.create({ collection: 'users', data: { ...CUSTOMER, name: 'Customer' } })
}

describeForDb('impersonation parallel', {}, (db) => {
	let booted: BootedPayload
	let partnerId: number | string

	beforeAll(async () => {
		booted = await bootPayload({
			collections: isolatedCollections,
			configOverrides: {
				admin: { user: 'users' },
				plugins: [impersonation({ access: { impersonate: () => true } })],
			},
			db,
			plugin: dualSession({ collections: ['partners'] }),
			seed: seedIsolated,
		})
		const partner = await booted.payload.find({
			collection: 'partners',
			limit: 1,
			where: { email: { equals: PARTNER.email } },
		})
		partnerId = partner.docs[0]?.id as number | string
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('starts in parallel against an isolated collection and restores the admin cookie', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })
		expect(client.cookieNames()).toContain('payload-token')

		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'partners', id: partnerId },
		})
		expect(start.status).toBe(200)
		expect((start.body as { user?: { email?: string } }).user?.email).toBe(PARTNER.email)
		expect(client.cookieNames()).toContain('payload-token')
		expect(client.cookieNames()).toContain('payload-partners-token')
		expect(client.cookieNames()).toContain('impersonation-hint')

		const current = await client.get('/api/impersonation')
		expect(current.body).toMatchObject({ active: true, mode: 'parallel' })

		const exit = await client.post('/api/impersonation/exit', { body: {} })
		expect(exit.status).toBe(200)
		expect(client.cookieNames()).toContain('payload-token')
		expect(client.cookieNames()).not.toContain('payload-partners-token')

		const me = await client.get('/api/users/me')
		expect((me.body as { user?: { email?: string } }).user?.email).toBe(ADMIN.email)
	})

	it('sets _impersonation on the impersonator after a parallel start', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })
		await client.get('/api/users/me')
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'partners', id: partnerId },
		})
		expect(start.status).toBe(200)
		const headers = new Headers({
			cookie: [...client.jar].map(([name, value]) => `${name}=${value}`).join('; '),
		})
		const { user } = await booted.payload.auth({ headers })
		expect((user as { email?: string } | null)?.email).toBe(ADMIN.email)
		expect((user as { _impersonation?: { mode?: string } } | null)?._impersonation?.mode).toBe(
			'parallel'
		)
		await client.post('/api/impersonation/exit', { body: {} })
	})
})

describeForDb('impersonation role-split fallback', {}, (db) => {
	it('falls back to swap when isolate keeps the target on the shared cookie', async () => {
		const booted = await bootPayload({
			collections: roleSplitCollections,
			configOverrides: {
				admin: { user: 'users' },
				plugins: [
					impersonation({
						access: { impersonate: () => true },
						targets: ['users'],
					}),
				],
			},
			db,
			plugin: dualSession({
				collections: [
					{
						isolate: (user: TypedUser) =>
							((user as { roles?: string[] }).roles ?? []).includes('customer'),
						slug: 'users',
					},
				],
			}),
			seed: seedRoleSplit,
		})
		try {
			await booted.payload.create({
				collection: 'users',
				data: {
					email: 'editor@10xmedia.de',
					name: 'Editor',
					password: 'password',
					roles: ['admin'],
				},
			})
			const client = createRestClient(booted)
			const editor = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: 'editor@10xmedia.de' } },
			})
			await client.post('/api/users/login', { body: STAFF })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: editor.docs[0]?.id },
			})
			expect(start.status).toBe(200)
			expect(start.body).toMatchObject({ user: { email: 'editor@10xmedia.de' } })
			const current = await client.get('/api/impersonation')
			expect(current.body).toMatchObject({ active: true, mode: 'swap' })
			expect(client.cookieNames()).toContain('payload-token')
			expect(client.cookieNames()).not.toContain('payload-users-token')
			await client.post('/api/impersonation/exit', { body: {} })
		} finally {
			await booted.stop()
		}
	})
})

describeForDb('impersonation parallel custom cookie', {}, (db) => {
	it('expires the dual-session cookieName on exit, not a guessed name', async () => {
		const booted = await bootPayload({
			collections: isolatedCollections,
			configOverrides: {
				admin: { user: 'users' },
				plugins: [impersonation({ access: { impersonate: () => true } })],
			},
			db,
			plugin: dualSession({
				collections: [{ cookieName: 'partner-session', slug: 'partners' }],
			}),
			seed: seedIsolated,
		})
		try {
			const partner = await booted.payload.find({
				collection: 'partners',
				limit: 1,
				where: { email: { equals: PARTNER.email } },
			})
			const client = createRestClient(booted)
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'partners', id: partner.docs[0]?.id },
			})
			expect(start.status).toBe(200)
			expect(client.cookieNames()).toContain('partner-session')
			const exit = await client.post('/api/impersonation/exit', { body: {} })
			expect(exit.status).toBe(200)
			expect(client.cookieNames()).not.toContain('partner-session')
		} finally {
			await booted.stop()
		}
	})
})

describeForDb('impersonation parallel maxDuration', {}, (db) => {
	it('expires the isolated cookie and keeps the impersonator', async () => {
		const booted = await bootPayload({
			collections: isolatedCollections,
			configOverrides: {
				admin: { user: 'users' },
				plugins: [impersonation({ access: { impersonate: () => true }, maxDuration: 3600 })],
			},
			db,
			plugin: dualSession({ collections: ['partners'] }),
			seed: seedIsolated,
		})
		try {
			const partner = await booted.payload.find({
				collection: 'partners',
				limit: 1,
				where: { email: { equals: PARTNER.email } },
			})
			const client = createRestClient(booted)
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'partners', id: partner.docs[0]?.id },
			})
			expect(start.status).toBe(200)
			expect(client.cookieNames()).toContain('payload-token')
			expect(client.cookieNames()).toContain('payload-partners-token')

			const rows = await booted.payload.find({
				collection: 'impersonation-sessions',
				limit: 1,
				overrideAccess: true,
				sort: '-startedAt',
			})
			await booted.payload.update({
				id: rows.docs[0]?.id as number | string,
				collection: 'impersonation-sessions',
				data: { absoluteExpiresAt: new Date(0).toISOString() } as never,
				overrideAccess: true,
			})

			const me = await client.get('/api/users/me')
			expect((me.body as { user?: { email?: string } }).user?.email).toBe(ADMIN.email)
			expect(client.cookieNames()).toContain('payload-token')
			expect(client.cookieNames()).not.toContain('payload-partners-token')
			expect(client.cookieNames()).not.toContain('impersonation-hint')

			const current = await client.get('/api/impersonation')
			expect(current.body).toMatchObject({ active: false })
			const after = await booted.payload.find({
				collection: 'impersonation-sessions',
				limit: 1,
				overrideAccess: true,
				sort: '-startedAt',
			})
			expect(after.docs[0]).toMatchObject({ endedBy: 'expired' })
		} finally {
			await booted.stop()
		}
	})
})
