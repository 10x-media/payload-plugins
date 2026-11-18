import { dualSession } from '@10x-media/dual-session'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type AuthStrategy, type CollectionConfig, JWTAuthentication, type Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { impersonation } from '../../src/index'
import type { ImpersonationPluginOptions } from '../../src/types'
import { asAuthUser } from '../../src/types'
import { createRestClient } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const TARGET = { email: 'target@10xmedia.de', password: 'password' }
const PARTNER = { email: 'partner@10xmedia.de', password: 'password' }
const SECOND_FACTOR = { 'x-second-factor': 'ok' }

// Stands in for payload-totp: the same JWT, labelled with its own strategy name
// only when the request carries the second factor.
const secondFactor: AuthStrategy = {
	name: 'second-factor',
	authenticate: (args) =>
		args.headers.get('x-second-factor') === 'ok' ? JWTAuthentication(args) : { user: null },
}

const collections: CollectionConfig[] = [
	{
		slug: 'users',
		auth: { strategies: [secondFactor] },
		fields: [{ name: 'name', type: 'text' }],
	},
	{
		slug: 'vault',
		access: {
			read: ({ req }) => Boolean(req.user && asAuthUser(req.user)._strategy === 'second-factor'),
		},
		fields: [{ name: 'name', type: 'text' }],
	},
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: { ...ADMIN, name: 'Admin' } })
	await payload.create({ collection: 'users', data: { ...TARGET, name: 'Target' } })
}

const boot = (db: Parameters<typeof bootPayload>[0]['db'], inheritStrategies?: string[]) => {
	const options: ImpersonationPluginOptions = {
		access: { impersonate: () => true, readRecords: () => true, terminate: () => true },
		inheritStrategies,
	}
	return bootPayload({
		collections,
		configOverrides: { admin: { user: 'users' } },
		db,
		plugin: impersonation(options),
		seed,
	})
}

const targetIdOf = async (payload: Payload) => {
	const found = await payload.find({
		collection: 'users',
		limit: 1,
		where: { email: { equals: TARGET.email } },
	})
	return found.docs[0]?.id
}

describeForDb('impersonation inheritStrategies', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await boot(db, ['second-factor'])
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('gives the target session the strategy the impersonator signed in with', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })

		const start = await client.post<{ record?: { id: number | string } }>(
			'/api/impersonation/start',
			{
				body: { collection: 'users', id: await targetIdOf(booted.payload) },
				headers: SECOND_FACTOR,
			}
		)
		expect(start.status).toBe(200)

		const rows = await booted.payload.find({
			collection: 'impersonation-sessions',
			where: { endedAt: { exists: false } },
		})
		expect(rows.docs[0]).toMatchObject({ impersonatorStrategy: 'second-factor' })

		const me = await client.get<{ user?: { email?: string } }>('/api/users/me')
		expect(me.body.user?.email).toBe(TARGET.email)

		const vault = await client.get('/api/vault')
		expect(vault.status).toBe(200)

		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('keeps the target on its own strategy when the impersonator had none to pass on', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })

		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: await targetIdOf(booted.payload) },
		})
		expect(start.status).toBe(200)

		const vault = await client.get('/api/vault')
		expect(vault.status).toBe(403)

		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('copies nothing by default', async () => {
		const plain = await boot(db)
		try {
			const client = createRestClient(plain)
			await client.post('/api/users/login', { body: ADMIN })

			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: await targetIdOf(plain.payload) },
				headers: SECOND_FACTOR,
			})
			expect(start.status).toBe(200)

			const vault = await client.get('/api/vault')
			expect(vault.status).toBe(403)
		} finally {
			await plain.stop()
		}
	})
})

describeForDb('impersonation inheritStrategies, parallel', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [
				...collections,
				{ slug: 'partners', auth: true, fields: [{ name: 'name', type: 'text' }] },
			],
			configOverrides: {
				admin: { user: 'users' },
				plugins: [
					impersonation({
						access: { impersonate: () => true },
						inheritStrategies: ['second-factor'],
					}),
				],
			},
			db,
			plugin: dualSession({ collections: ['partners'] }),
			seed: async (payload) => {
				await payload.create({ collection: 'users', data: { ...ADMIN, name: 'Admin' } })
				await payload.create({ collection: 'partners', data: { ...PARTNER, name: 'Partner' } })
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('passes the strategy to the target side only', async () => {
		const client = createRestClient(booted)
		await client.post('/api/users/login', { body: ADMIN })
		const partner = await booted.payload.find({ collection: 'partners', limit: 1 })

		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'partners', id: partner.docs[0]?.id },
			headers: SECOND_FACTOR,
		})
		expect(start.status).toBe(200)

		const authAs = async (tokenCookie: string) => {
			const cookie = [tokenCookie, 'impersonation-hint']
				.map((name) => `${name}=${client.jar.get(name)}`)
				.join('; ')
			const { user } = await booted.payload.auth({ headers: new Headers({ cookie }) })
			return user ? { email: user.email, strategy: asAuthUser(user)._strategy } : null
		}

		expect(await authAs('payload-token')).toEqual({ email: ADMIN.email, strategy: 'local-jwt' })
		expect(await authAs('payload-partners-token')).toEqual({
			email: PARTNER.email,
			strategy: 'second-factor',
		})
	})
})
