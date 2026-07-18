import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Plugin } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encryptedField, withEncryptedQueryRewrite } from '../../src/exports/encrypted'
import { fields } from '../../src/index'

const members: CollectionConfig = {
	slug: 'members',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField({ name: 'contact', type: 'email', unique: true }, { queryable: true }),
		...encryptedField({ name: 'handle', type: 'text' }, { queryable: true }),
		...encryptedField({ name: 'ssn', type: 'text' }),
	],
}

describeForDb('encrypted queryability (plugin-registered rewrite)', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ collections: [members], db, plugin: fields({}) })
		await booted.payload.create({
			collection: 'members',
			data: { contact: 'Jane.Doe@Example.com', handle: 'Jane', ssn: 's-1', title: 'jane' },
		})
		await booted.payload.create({
			collection: 'members',
			data: { contact: 'bob@x.com', handle: 'bob', ssn: 's-2', title: 'bob' },
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('equals matches with trim + case-fold normalization for email', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { equals: '  jane.doe@EXAMPLE.com ' } },
		})
		expect(found.totalDocs).toBe(1)
		expect(found.docs[0]?.title).toBe('jane')
	})

	it('standard normalization trims but keeps case', async () => {
		const exact = await booted.payload.find({
			collection: 'members',
			where: { handle: { equals: ' Jane ' } },
		})
		expect(exact.totalDocs).toBe(1)
		const wrongCase = await booted.payload.find({
			collection: 'members',
			where: { handle: { equals: 'jane' } },
		})
		expect(wrongCase.totalDocs).toBe(0)
	})

	it('in matches any listed value', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { in: ['jane.doe@example.com', 'nobody@x.com'] } },
		})
		expect(found.totalDocs).toBe(1)
	})

	it('misses cleanly on unknown values', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { equals: 'ghost@x.com' } },
		})
		expect(found.totalDocs).toBe(0)
	})

	it('recurses and/or combinations', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: {
				or: [
					{ and: [{ contact: { equals: 'jane.doe@example.com' } }, { title: { equals: 'jane' } }] },
					{ contact: { equals: 'bob@x.com' } },
				],
			},
		})
		expect(found.totalDocs).toBe(2)
	})

	it('rewrites count and bulk delete wheres', async () => {
		const counted = await booted.payload.count({
			collection: 'members',
			where: { contact: { equals: 'jane.doe@example.com' } },
		})
		expect(counted.totalDocs).toBe(1)

		const victim = await booted.payload.create({
			collection: 'members',
			data: { contact: 'delete-me@x.com', handle: 'del', ssn: 's-3', title: 'del' },
		})
		const deleted = await booted.payload.delete({
			collection: 'members',
			where: { contact: { equals: 'delete-me@x.com' } },
		})
		expect(deleted.docs).toHaveLength(1)
		expect(deleted.docs[0]?.id).toBe(victim.id)
	})

	it('non-queryable encrypted fields match nothing by plaintext equals', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { ssn: { equals: 's-1' } },
		})
		expect(found.totalDocs).toBe(0)
	})

	it('enforces unique through the blind index on both DBs', async () => {
		await expect(
			booted.payload.create({
				collection: 'members',
				data: { contact: 'JANE.DOE@example.com', handle: 'imposter', ssn: 'x', title: 'dup' },
			})
		).rejects.toThrow()
	})

	it('hides the bidx sibling from reads (hidden field strip)', async () => {
		const found = await booted.payload.find({ collection: 'members', where: {} })
		const doc = found.docs[0] as Record<string, unknown>
		expect('contact_bidx' in doc).toBe(false)
		expect('handle_bidx' in doc).toBe(false)
	})
})

describeForDb('encrypted queryability (standalone, no plugin)', { dbs: ['mongo'] }, (db) => {
	const passthroughPlugin: Plugin = (config) => config
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [
				withEncryptedQueryRewrite({
					slug: 'standalone',
					fields: [
						{ name: 'title', type: 'text' },
						...encryptedField({ name: 'contact', type: 'email' }, { queryable: true }),
					],
				}),
			],
			db,
			plugin: passthroughPlugin,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('rewrites queries and derives default keys from the config secret without the plugin', async () => {
		await booted.payload.create({
			collection: 'standalone',
			data: { contact: 'solo@x.com', title: 'solo' },
		})
		const found = await booted.payload.find({
			collection: 'standalone',
			where: { contact: { equals: 'solo@x.com' } },
		})
		expect(found.totalDocs).toBe(1)
	})
})
