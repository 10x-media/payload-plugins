import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { impersonation } from '../../src/index'
import { closeStaleImpersonations } from '../../src/session/closeStale'
import { createRestClient } from './helpers/rest'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const TARGET = { email: 'target@10xmedia.de', password: 'password' }

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [{ name: 'name', type: 'text' }] },
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: { ...ADMIN, name: 'Admin' } })
	await payload.create({ collection: 'users', data: { ...TARGET, name: 'Target' } })
}

const sessionsOf = async (payload: Payload, email: string) => {
	const user = (await payload.db.findOne({
		collection: 'users',
		where: { email: { equals: email } },
	})) as { id: number | string; sessions?: { expiresAt: Date | string; id: string }[] } | null
	return user
}

describeForDb('impersonation lifecycle', {}, (db) => {
	let booted: BootedPayload
	let client: ReturnType<typeof createRestClient>
	let adminId: number | string
	let targetId: number | string

	beforeAll(async () => {
		booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({
				access: {
					impersonate: () => true,
					readRecords: () => true,
					terminate: () => true,
				},
			}),
			seed,
		})
		client = createRestClient(booted)
		const admin = await booted.payload.find({
			collection: 'users',
			limit: 1,
			where: { email: { equals: ADMIN.email } },
		})
		const target = await booted.payload.find({
			collection: 'users',
			limit: 1,
			where: { email: { equals: TARGET.email } },
		})
		adminId = admin.docs[0]?.id as number | string
		targetId = target.docs[0]?.id as number | string
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('starts, binds req.user to the target, then exits restoring the admin', async () => {
		const login = await client.post('/api/users/login', { body: ADMIN })
		expect(login.status).toBe(200)

		const beforeTarget = await sessionsOf(booted.payload, TARGET.email)
		const beforeCount = beforeTarget?.sessions?.length ?? 0

		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		expect((start.body as { user?: { email?: string } }).user?.email).toBe(TARGET.email)
		expect(client.cookieNames()).toContain('payload-token')
		expect(client.cookieNames()).toContain('impersonation-hint')

		const afterStart = await sessionsOf(booted.payload, TARGET.email)
		expect(afterStart?.sessions?.length).toBe(beforeCount + 1)

		const me = await client.get('/api/users/me')
		expect((me.body as { user?: { email?: string } }).user?.email).toBe(TARGET.email)

		const current = await client.get('/api/impersonation')
		expect(current.body).toMatchObject({ active: true })

		const exit = await client.post('/api/impersonation/exit', { body: {} })
		expect(exit.status).toBe(200)

		const afterExit = await sessionsOf(booted.payload, TARGET.email)
		expect(afterExit?.sessions?.length).toBe(beforeCount)

		const meAgain = await client.get('/api/users/me')
		expect((meAgain.body as { user?: { email?: string } }).user?.email).toBe(ADMIN.email)
		void adminId
	})

	it('refuses anonymous, self, and cross-origin cookie POSTs', async () => {
		const anon = createRestClient(booted)
		const unauth = await anon.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(unauth.status).toBe(403)

		const login = await client.post('/api/users/login', { body: ADMIN })
		expect(login.status).toBe(200)

		const self = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: adminId },
		})
		expect(self.status).toBe(400)
		expect(self.body).toMatchObject({ error: 'selfTarget' })

		const cross = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
			headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
		})
		expect(cross.status).toBe(403)
		expect(cross.body).toMatchObject({ error: 'origin' })
	})

	it('does not drop the row after a real refresh extends the minted session', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)

		const before = await sessionsOf(booted.payload, TARGET.email)
		const minted = before?.sessions?.at(-1)
		expect(minted).toBeTruthy()

		const refresh = await client.post('/api/users/refresh-token', { body: {} })
		expect(refresh.status).toBe(200)

		const after = await sessionsOf(booted.payload, TARGET.email)
		const updated = after?.sessions?.find((session) => session.id === minted?.id)
		expect(updated).toBeTruthy()
		expect(new Date(updated?.expiresAt ?? 0).getTime()).toBeGreaterThan(
			new Date(minted?.expiresAt ?? 0).getTime() - 1
		)

		const current = await client.get('/api/impersonation')
		expect(current.body).toMatchObject({ active: true })

		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('ignores a forged hint cookie pointing at another row', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		client.setCookie('impersonation-hint', 'totally-forged')
		const current = await client.get('/api/impersonation')
		expect(current.body).toMatchObject({ active: true })
		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('terminate revokes the minted sid so the next request is unauthenticated', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)

		const records = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
		})
		const recordId = records.docs[0]?.id
		expect(recordId).toBeTruthy()

		const end = await client.post(`/api/impersonation/${recordId}/end`, { body: {} })
		expect(end.status).toBe(200)

		const me = await client.get('/api/users/me')
		expect((me.body as { user?: unknown }).user).toBeFalsy()
	})

	it('refuses a nested start while an open row exists for the caller', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const nested = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(nested.status).toBe(409)
		expect(nested.body).toMatchObject({ error: 'alreadyImpersonating' })
		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('keeps a single open row when two starts race', async () => {
		const racer = createRestClient(booted)
		await racer.post('/api/users/login', { body: ADMIN })
		const cookie = [...racer.jar].map(([name, value]) => `${name}=${value}`).join('; ')
		const left = createRestClient(booted)
		const right = createRestClient(booted)
		const [first, second] = await Promise.all([
			left.post('/api/impersonation/start', {
				body: { collection: 'users', id: targetId },
				cookie,
			}),
			right.post('/api/impersonation/start', {
				body: { collection: 'users', id: targetId },
				cookie,
			}),
		])
		const statuses = [first.status, second.status].sort()
		expect(statuses).toEqual([200, 409])
		const open = await booted.payload.find({
			collection: 'impersonation-sessions',
			overrideAccess: true,
			where: { endedAt: { exists: false } },
		})
		expect(open.totalDocs).toBe(1)
		const winner = first.status === 200 ? left : right
		await winner.post('/api/impersonation/exit', { body: {} })
	})

	it('sets _impersonation on the target after start', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const headers = new Headers({
			cookie: [...client.jar].map(([name, value]) => `${name}=${value}`).join('; '),
		})
		const { user } = await booted.payload.auth({ headers })
		expect(
			(user as { _impersonation?: { impersonator?: { id?: unknown } } } | null)?._impersonation
				?.impersonator
		).toBeTruthy()
		await client.post('/api/impersonation/exit', { body: {} })
	})

	it('logout closes the row and revokes the minted sid', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const before = await sessionsOf(booted.payload, TARGET.email)
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const logout = await client.post('/api/users/logout', { body: {} })
		expect(logout.status).toBe(200)
		const rows = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
		})
		expect(rows.docs[0]).toMatchObject({ endedBy: 'logout' })
		const after = await sessionsOf(booted.payload, TARGET.email)
		expect(after?.sessions?.length ?? 0).toBe(before?.sessions?.length ?? 0)
	})

	it('exit with an expired impersonator session returns impersonatorSessionExpired', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const records = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
			where: { endedAt: { exists: false } },
		})
		const record = records.docs[0] as { impersonatorSid?: string } | undefined
		const admin = await sessionsOf(booted.payload, ADMIN.email)
		expect(admin?.sessions?.length).toBeGreaterThan(0)
		await booted.payload.db.updateOne({
			id: admin?.id as number | string,
			collection: 'users',
			data: {
				sessions: (admin?.sessions ?? []).map((session) =>
					session.id === record?.impersonatorSid
						? { ...session, expiresAt: new Date(0).toISOString() }
						: session
				),
			},
			returning: false,
		})
		const exit = await client.post('/api/impersonation/exit', { body: {} })
		expect(exit.status).toBe(409)
		expect(exit.body).toMatchObject({ error: 'impersonatorSessionExpired' })
		const closed = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
		})
		expect(closed.docs[0]).toMatchObject({ endedBy: 'expired' })
	})

	it('keeps an out-of-band target session when the minted sid is revoked', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const target = await sessionsOf(booted.payload, TARGET.email)
		const extra = {
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			id: 'extra-sid',
		}
		await booted.payload.db.updateOne({
			id: target?.id as number | string,
			collection: 'users',
			data: { sessions: [...(target?.sessions ?? []), extra] },
			returning: false,
		})
		await client.post('/api/impersonation/exit', { body: {} })
		const after = await sessionsOf(booted.payload, TARGET.email)
		expect(after?.sessions?.some((session) => session.id === 'extra-sid')).toBe(true)
	})

	it('closeStaleImpersonations closes a row whose minted sid vanished', async () => {
		await client.post('/api/users/login', { body: ADMIN })
		const start = await client.post('/api/impersonation/start', {
			body: { collection: 'users', id: targetId },
		})
		expect(start.status).toBe(200)
		const records = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
			where: { endedAt: { exists: false } },
		})
		const record = records.docs[0] as { targetSid?: string } | undefined
		const target = await sessionsOf(booted.payload, TARGET.email)
		await booted.payload.db.updateOne({
			id: target?.id as number | string,
			collection: 'users',
			data: {
				sessions: (target?.sessions ?? []).filter((session) => session.id !== record?.targetSid),
			},
			returning: false,
		})
		const closed = await closeStaleImpersonations(booted.payload)
		expect(closed).toBeGreaterThanOrEqual(1)
		const after = await booted.payload.find({
			collection: 'impersonation-sessions',
			limit: 1,
			overrideAccess: true,
			sort: '-startedAt',
		})
		expect(after.docs[0]).toMatchObject({ endedBy: 'expired' })
		await client.post('/api/users/login', { body: ADMIN })
	})
})

describeForDb('impersonation refusals', {}, (db) => {
	it('treats a Where return as deny', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({
				access: { impersonate: () => ({ id: { exists: true } }) },
			}),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(403)
			expect(start.body).toMatchObject({ error: 'forbidden' })
		} finally {
			await booted.stop()
		}
	})

	it('revokes the minted sid when onStart throws', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({
				access: { impersonate: () => true },
				onStart: () => {
					throw new Error('boom')
				},
			}),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const before = await sessionsOf(booted.payload, TARGET.email)
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(500)
			const after = await sessionsOf(booted.payload, TARGET.email)
			expect(after?.sessions?.length ?? 0).toBe(before?.sessions?.length ?? 0)
		} finally {
			await booted.stop()
		}
	})

	it('denies a junk Authorization when jwtOrder ranks cookie first', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: {
				admin: { user: 'users' },
				auth: { jwtOrder: ['cookie', 'JWT', 'Bearer'] },
			},
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
				headers: {
					Authorization: 'JWT junk',
					Origin: 'https://evil.example',
					'Sec-Fetch-Site': 'cross-site',
				},
			})
			expect(start.status).toBe(403)
			expect(start.body).toMatchObject({ error: 'origin' })
		} finally {
			await booted.stop()
		}
	})

	it('logout with a custom cookiePrefix expires the auth cookie and not the hint', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' }, cookiePrefix: 'acme' },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			await client.post('/api/users/login', { body: ADMIN })
			expect(client.cookieNames()).toContain('acme-token')
			client.setCookie('impersonation-hint', 'leftover')
			const logout = await client.post('/api/users/logout', { body: {} })
			expect(logout.status).toBe(200)
			expect(client.cookieNames()).not.toContain('acme-token')
			expect(client.cookieNames()).toContain('impersonation-hint')
		} finally {
			await booted.stop()
		}
	})

	it('expires the prefix-derived tenant cookie on start', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' }, cookiePrefix: 'acme' },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			client.setCookie('acme-tenant', 'tenant-a')
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(200)
			expect(client.cookieNames()).not.toContain('acme-tenant')
			await client.post('/api/impersonation/exit', { body: {} })
		} finally {
			await booted.stop()
		}
	})

	it('refuses start without a reason when reason is required', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true }, reason: 'required' }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(400)
			expect(start.body).toMatchObject({ error: 'reasonRequired' })
		} finally {
			await booted.stop()
		}
	})

	it('refuses a collection outside targets', async () => {
		const booted = await bootPayload({
			collections: [
				...collections,
				{ slug: 'staff', auth: true, fields: [{ name: 'name', type: 'text' }] },
			],
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({
				access: { impersonate: () => true },
				targets: ['users'],
			}),
			seed: async (payload) => {
				await seed(payload)
				await payload.create({
					collection: 'staff',
					data: { email: 'staff@10xmedia.de', name: 'Staff', password: 'password' },
				})
			},
		})
		try {
			const client = createRestClient(booted)
			const staff = await booted.payload.find({
				collection: 'staff',
				limit: 1,
				where: { email: { equals: 'staff@10xmedia.de' } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'staff', id: staff.docs[0]?.id },
			})
			expect(start.status).toBe(400)
			expect(start.body).toMatchObject({ error: 'unsupportedCollection' })
		} finally {
			await booted.stop()
		}
	})

	it('refuses an unverified target when auth.verify is on', async () => {
		const booted = await bootPayload({
			collections: [
				{
					slug: 'users',
					auth: { verify: true },
					fields: [{ name: 'name', type: 'text' }],
				},
			],
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed: async (payload) => {
				await payload.create({
					collection: 'users',
					data: { ...ADMIN, _verified: true, name: 'Admin' },
				})
				await payload.create({
					collection: 'users',
					data: { ...TARGET, name: 'Target' },
				})
			},
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(403)
			expect(start.body).toMatchObject({ error: 'targetUnverified' })
		} finally {
			await booted.stop()
		}
	})

	it('refuses a trashed target', async () => {
		const booted = await bootPayload({
			collections: [
				{
					slug: 'users',
					auth: true,
					fields: [{ name: 'name', type: 'text' }],
					trash: true,
				},
			],
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			const targetId = target.docs[0]?.id as number | string
			await booted.payload.update({
				id: targetId,
				collection: 'users',
				data: { deletedAt: new Date().toISOString() } as never,
				overrideAccess: true,
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: targetId },
			})
			expect(start.status).toBe(403)
			expect(start.body).toMatchObject({ error: 'targetTrashed' })
		} finally {
			await booted.stop()
		}
	})

	it('kills the session when absoluteExpiresAt is in the past', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true }, maxDuration: 3600 }),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(200)
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
			expect((me.body as { user?: unknown }).user).toBeFalsy()
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

	it('returns failed when compensating revoke also throws', async () => {
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({
				access: { impersonate: () => true },
				onStart: () => {
					throw new Error('boom')
				},
				session: {
					revoke: async () => {
						throw new Error('nope')
					},
				},
			}),
			seed,
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			await client.post('/api/users/login', { body: ADMIN })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(500)
			expect(start.body).toMatchObject({ error: 'failed' })
		} finally {
			await booted.stop()
		}
	})

	it('exit after the impersonator is deleted returns impersonatorGone', async () => {
		const extra = { email: 'other-admin@10xmedia.de', password: 'password' }
		const booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true } }),
			seed: async (payload) => {
				await seed(payload)
				await payload.create({ collection: 'users', data: { ...extra, name: 'Other' } })
			},
		})
		try {
			const client = createRestClient(booted)
			const target = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: TARGET.email } },
			})
			const actor = await booted.payload.find({
				collection: 'users',
				limit: 1,
				where: { email: { equals: extra.email } },
			})
			await client.post('/api/users/login', { body: extra })
			const start = await client.post('/api/impersonation/start', {
				body: { collection: 'users', id: target.docs[0]?.id },
			})
			expect(start.status).toBe(200)
			await booted.payload.delete({
				collection: 'users',
				id: actor.docs[0]?.id as number | string,
				overrideAccess: true,
			})
			const exit = await client.post('/api/impersonation/exit', { body: {} })
			expect(exit.status).toBe(409)
			expect(exit.body).toMatchObject({ error: 'impersonatorGone' })
		} finally {
			await booted.stop()
		}
	})
})
