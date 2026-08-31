import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SLUG = 'analytics-providers'

const accessUsers: CollectionConfig = { slug: 'access-users', auth: true, fields: [] }

const scopeByEmail: Record<string, string | null> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'root@t.dev': null,
}

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

describeForDb('analytics providers collection: scoped access', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let userA: Awaited<ReturnType<typeof login>>
	let userRoot: Awaited<ReturnType<typeof login>>
	let docB: { id: string | number }

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: ({ req }) =>
					scopeByEmail[(req.user as { email?: string })?.email ?? ''] ?? null,
				access: {
					platformRead: ({ req }) => (req.user as { email?: string })?.email === 'root@t.dev',
				},
				providers: { collection: true },
			}),
		})
		userA = await login(booted.payload, 'a@t.dev')
		userRoot = await login(booted.payload, 'root@t.dev')
		docB = (await booted.payload.create({
			collection: SLUG as never,
			data: { name: 'B umami', provider: 'umami', enabled: true, scope: 'tenant-b' } as never,
			user: userRoot,
			overrideAccess: false,
		})) as unknown as { id: string | number }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('a tenant user creates a provider and it is stamped with their scope', async () => {
		const doc = await booted.payload.create({
			collection: SLUG as never,
			data: { name: 'A plausible', provider: 'plausible', enabled: true } as never,
			user: userA,
			overrideAccess: false,
		})
		expect((doc as { scope?: string }).scope).toBe('tenant-a')
	})

	it('tenant list views only show the tenant’s own docs', async () => {
		const { docs } = await booted.payload.find({
			collection: SLUG as never,
			user: userA,
			overrideAccess: false,
		})
		expect(docs.every((d) => (d as { scope?: string }).scope === 'tenant-a')).toBe(true)
	})

	it('a tenant cannot read another tenant’s doc by id', async () => {
		await expect(
			booted.payload.findByID({
				collection: SLUG as never,
				id: docB.id,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('a tenant cannot update or delete another tenant’s doc', async () => {
		await expect(
			booted.payload.update({
				collection: SLUG as never,
				id: docB.id,
				data: { enabled: false } as never,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
		await expect(
			booted.payload.delete({
				collection: SLUG as never,
				id: docB.id,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('a tenant cannot create a doc claiming another scope', async () => {
		await expect(
			booted.payload.create({
				collection: SLUG as never,
				data: { name: 'X', provider: 'plausible', scope: 'tenant-b' } as never,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('the platform user sees and manages every scope', async () => {
		const { docs } = await booted.payload.find({
			collection: SLUG as never,
			user: userRoot,
			overrideAccess: false,
		})
		expect(docs.length).toBeGreaterThanOrEqual(2)
		const created = await booted.payload.create({
			collection: SLUG as never,
			data: { name: 'Root for B', provider: 'umami', scope: 'tenant-b' } as never,
			user: userRoot,
			overrideAccess: false,
		})
		expect((created as { scope?: string }).scope).toBe('tenant-b')
	})
})

describeForDb('analytics providers collection: unscoped access', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				providers: { collection: true },
			}),
		})
		user = await login(booted.payload, 'a@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('any authenticated user can create and read providers (historic behavior)', async () => {
		const created = await booted.payload.create({
			collection: SLUG as never,
			data: { name: 'Unscoped plausible', provider: 'plausible', enabled: true } as never,
			user,
			overrideAccess: false,
		})
		expect((created as { scope?: string }).scope).toBeFalsy()

		const { docs } = await booted.payload.find({
			collection: SLUG as never,
			user,
			overrideAccess: false,
		})
		expect(docs.length).toBeGreaterThanOrEqual(1)
	})
})
