import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { impersonation } from '../../src/index'
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

describeForDb('impersonation cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections,
			configOverrides: { admin: { user: 'users' } },
			db,
			plugin: impersonation({ access: { impersonate: () => true, terminate: () => true } }),
			seed,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`starts and exits against ${db}`, async () => {
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
		const exit = await client.post('/api/impersonation/exit', { body: {} })
		expect(exit.status).toBe(200)
	})
})
