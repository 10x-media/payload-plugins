import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, seedUser, tags, users } from './fixtures'

describe('createdBy / lastModifiedBy fields', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	let userId: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					posts: { auditFields: true },
					tags: { auditFields: { lastModifiedBy: { name: 'touchedBy', label: 'Touched by' } } },
				},
			}),
			db: 'mongo',
			collections: [posts, tags, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				userId = String(user.id)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('adds both fields to an opted-in collection', () => {
		const fields = booted.payload.collections.posts?.config.fields ?? []
		const names = fields.map((f) => ('name' in f ? f.name : undefined))

		expect(names).toContain('createdBy')
		expect(names).toContain('lastModifiedBy')
	})

	it('adds no fields to a collection that did not opt in', () => {
		const fields = booted.payload.collections.users?.config.fields ?? []
		const names = fields.map((f) => ('name' in f ? f.name : undefined))

		expect(names).not.toContain('createdBy')
	})

	it('honours a renamed field and omits the one left out', () => {
		const fields = booted.payload.collections.tags?.config.fields ?? []
		const names = fields.map((f) => ('name' in f ? f.name : undefined))

		expect(names).toContain('touchedBy')
		expect(names).not.toContain('lastModifiedBy')
		expect(names).not.toContain('createdBy')
	})

	it('stamps both fields on create', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Stamped' },
			req,
			depth: 0,
		})

		expect(String(doc.createdBy)).toBe(userId)
		expect(String(doc.lastModifiedBy)).toBe(userId)
	})

	it('leaves createdBy alone on update', async () => {
		const other = await booted.payload.create({
			collection: 'users',
			data: { email: 'second@example.com', password: 'password' },
		})
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Reassigned' },
			req,
			depth: 0,
		})

		const updated = await booted.payload.update({
			collection: 'posts',
			id: doc.id,
			data: { title: 'Reassigned again' },
			req: { user: { ...other, collection: 'users' } } as unknown as PayloadRequest,
			depth: 0,
		})

		expect(String(updated.createdBy)).toBe(userId)
		expect(String(updated.lastModifiedBy)).toBe(String(other.id))
	})

	it('leaves the fields empty for an unauthenticated write', async () => {
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Anonymous' },
			depth: 0,
		})

		expect(doc.createdBy ?? null).toBeNull()
	})
})
