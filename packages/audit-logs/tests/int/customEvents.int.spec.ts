import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { auditLogs, createAuditEvent } from '../../src/index'
import { filterConditions } from '../../src/view/filterQuery'
import { posts, readLogs, seedUser, tags, users } from './fixtures'

const tenants: CollectionConfig = { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }

const admins: CollectionConfig = {
	slug: 'admins',
	auth: true,
	fields: [{ name: 'name', type: 'text' }],
}

/**
 * `createAuditEvent` beyond `req`: a tenant and a user passed in, as work a person
 * started runs in a job with neither, and the group read from the configured key.
 */
describeForDb('createAuditEvent with multiTenancy', {}, (db) => {
	let booted: BootedPayload
	let userId: number | string
	let tenantA: number | string
	let tenantB: number | string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: { posts: { auditLog: true } },
				logs: { group: { contextKey: 'custom' } },
				multiTenancy: true,
			}),
			db,
			collections: [posts, tags, users, tenants],
			seed: async (payload) => {
				userId = (await seedUser(payload)).id
				tenantA = (await payload.create({ collection: 'tenants', data: { name: 'A' } })).id
				tenantB = (await payload.create({ collection: 'tenants', data: { name: 'B' } })).id
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	/** The entries the tenant view lists for `tenant`, through the same conditions it builds. */
	const tenantView = (tenant: number | string, eventType: string) =>
		readLogs(booted.payload, {
			and: filterConditions({ eventTypes: [eventType] }, { lockedTenantId: String(tenant) }),
		})

	it('lists an event with a tenant in that tenant view only', async () => {
		await createAuditEvent(await createLocalReq({}, booted.payload), {
			collection: 'posts',
			eventType: 'tenant_scoped',
			tenant: tenantA,
		})

		expect(await tenantView(tenantA, 'tenant_scoped')).toHaveLength(1)
		expect(await tenantView(tenantB, 'tenant_scoped')).toHaveLength(0)
	})

	it('attributes the event to the given user when the request has none', async () => {
		const req = await createLocalReq({}, booted.payload)
		expect(req.user).toBeFalsy()

		await createAuditEvent(req, {
			collection: 'posts',
			eventType: 'job_finished',
			user: { collection: 'users', id: userId },
		})

		const [entry] = await readLogs(booted.payload, { eventType: { equals: 'job_finished' } })
		expect(entry?.user).toEqual({ relationTo: 'users', value: String(userId) })
	})

	it('reads the group from the configured context key', async () => {
		const req = await createLocalReq(
			{ context: { custom: 'g', auditGroup: 'other' } },
			booted.payload
		)

		await createAuditEvent(req, { collection: 'posts', eventType: 'grouped' })

		const [entry] = await readLogs(booted.payload, { eventType: { equals: 'grouped' } })
		expect(entry?.group).toBe('g')
	})
})

describeForDb('createAuditEvent with several auth collections', {}, (db) => {
	let booted: BootedPayload
	let adminId: number | string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ collections: { posts: { auditLog: true } } }),
			db,
			collections: [posts, tags, users, admins],
			seed: async (payload) => {
				await seedUser(payload)
				adminId = (
					await payload.create({
						collection: 'admins',
						data: { email: 'admin@example.com', password: 'password' },
					})
				).id
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores the given user as a polymorphic pair', async () => {
		await createAuditEvent(await createLocalReq({}, booted.payload), {
			collection: 'posts',
			eventType: 'job_finished',
			user: { collection: 'admins', id: adminId },
		})

		const [entry] = await readLogs(booted.payload, { eventType: { equals: 'job_finished' } })
		expect(entry?.user).toEqual({ relationTo: 'admins', value: String(adminId) })
	})

	it('warns and drops a tenant when multiTenancy is off', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')

		await createAuditEvent(await createLocalReq({}, booted.payload), {
			collection: 'posts',
			eventType: 'no_tenancy',
			tenant: 'anything',
		})

		const [entry] = await readLogs(booted.payload, { eventType: { equals: 'no_tenancy' } })
		expect(entry).toBeDefined()
		expect(entry && 'tenant' in entry).toBe(false)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('multiTenancy is not configured'))
		warn.mockRestore()
	})
})
