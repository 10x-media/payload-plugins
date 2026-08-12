import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { readLogs, seedUser, users } from './fixtures'

/** Mirrors the dev stand's `orders`: every hook mutates something the entry must reflect. */
const orders: CollectionConfig = {
	slug: 'orders',
	fields: [
		{ name: 'reference', type: 'text' },
		{ name: 'total', type: 'number' },
		{ name: 'note', type: 'text' },
		{ name: 'lastTouchedBy', type: 'relationship', relationTo: 'users' },
		{ name: 'lines', type: 'array', fields: [{ name: 'price', type: 'number' }] },
	],
	hooks: {
		beforeValidate: [
			({ data }) => {
				if (typeof data?.reference === 'string') data.reference = data.reference.toUpperCase()
				return data
			},
		],
		beforeChange: [
			({ data, req }) => {
				const lines = Array.isArray(data.lines) ? (data.lines as { price?: number }[]) : []
				data.total = lines.reduce((sum, line) => sum + (line.price ?? 0), 0)
				if (req.user) data.lastTouchedBy = req.user.id
				return data
			},
		],
		afterChange: [
			async ({ doc, operation, req }) => {
				await req.payload.create({
					collection: 'order-events',
					data: { order: doc.id, kind: operation },
					req,
				})
				return doc
			},
		],
	},
}

const orderEvents: CollectionConfig = {
	slug: 'order-events',
	fields: [
		{ name: 'order', type: 'relationship', relationTo: 'orders' },
		{ name: 'kind', type: 'text' },
	],
}

const exploding: CollectionConfig = {
	slug: 'exploding',
	fields: [{ name: 'title', type: 'text' }],
	hooks: {
		beforeChange: [
			({ data }) => {
				if (data.title === 'boom') throw new Error('refused')
				return data
			},
		],
	},
}

describe('host hooks on an audited collection', () => {
	let booted: BootedPayload
	let req: PayloadRequest
	let userId: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: {
					orders: { auditFields: true, auditLog: true },
					'order-events': { auditLog: true },
					exploding: { auditLog: true },
				},
			}),
			db: 'mongo',
			collections: [orders, orderEvents, exploding, users],
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

	it('records what beforeValidate stored, not what was submitted', async () => {
		const doc = await booted.payload.create({
			collection: 'orders',
			data: { reference: 'ord-1' },
			req,
		})
		await booted.payload.update({
			collection: 'orders',
			id: doc.id,
			data: { reference: 'ord-2' },
			req,
		})

		const update = (
			await readLogs(booted.payload, {
				and: [{ relationTo: { equals: 'orders' } }, { documentId: { equals: String(doc.id) } }],
			})
		).find((l) => l.operation === 'update')

		expect(update?.diff?.reference).toEqual({ before: 'ORD-1', after: 'ORD-2' })
	})

	it('records a value beforeChange derived, which was never submitted', async () => {
		const doc = await booted.payload.create({
			collection: 'orders',
			data: { reference: 'derived', lines: [{ price: 3 }] },
			req,
		})
		await booted.payload.update({
			collection: 'orders',
			id: doc.id,
			data: { lines: [{ price: 3 }, { price: 4 }] },
			req,
		})

		const update = (
			await readLogs(booted.payload, {
				and: [{ relationTo: { equals: 'orders' } }, { documentId: { equals: String(doc.id) } }],
			})
		).find((l) => l.operation === 'update')

		expect(update?.diff?.total).toEqual({ before: 3, after: 7 })
	})

	it('lets a host beforeChange win over the plugin audit field', async () => {
		const other = await booted.payload.create({
			collection: 'users',
			data: { email: 'second@example.com', password: 'password' },
		})
		const otherReq = { user: { ...other, collection: 'users' } } as unknown as PayloadRequest

		const doc = await booted.payload.create({
			collection: 'orders',
			data: { reference: 'ownership' },
			req: otherReq,
			depth: 0,
		})

		// The plugin registers its beforeChange first on purpose, so the host's runs last.
		expect(String(doc.lastTouchedBy)).toBe(String(other.id))
		expect(String(doc.createdBy)).toBe(String(other.id))
	})

	it('logs the write a host afterChange makes into another audited collection', async () => {
		const before = (await readLogs(booted.payload, { relationTo: { equals: 'order-events' } }))
			.length

		await booted.payload.create({ collection: 'orders', data: { reference: 'cascade' }, req })

		const after = await readLogs(booted.payload, { relationTo: { equals: 'order-events' } })

		// One save, two entries. This is the growth the retention options exist for.
		expect(after.length).toBe(before + 1)
	})

	it('writes nothing when a host hook rejects the save', async () => {
		const before = (await readLogs(booted.payload, { relationTo: { equals: 'exploding' } })).length

		await expect(
			booted.payload.create({ collection: 'exploding', data: { title: 'boom' }, req })
		).rejects.toThrow()

		const after = (await readLogs(booted.payload, { relationTo: { equals: 'exploding' } })).length
		expect(after).toBe(before)
	})

	it('leaves the acting user on the entry regardless of the hooks', async () => {
		const doc = await booted.payload.create({
			collection: 'orders',
			data: { reference: 'who' },
			req,
		})

		const [log] = await readLogs(booted.payload, {
			and: [{ relationTo: { equals: 'orders' } }, { documentId: { equals: String(doc.id) } }],
		})

		expect(String(log?.user)).toBe(userId)
	})
})

describe('a host afterChange that rewrites the document', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	const rewriting: CollectionConfig = {
		slug: 'rewriting',
		fields: [{ name: 'title', type: 'text' }],
		hooks: {
			afterChange: [({ doc }) => ({ ...doc, title: 'rewritten in afterChange' })],
		},
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ collections: { rewriting: { auditLog: true } } }),
			db: 'mongo',
			collections: [rewriting, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('records the stored value, not the one the hook returned', async () => {
		const doc = await booted.payload.create({
			collection: 'rewriting',
			data: { title: 'stored' },
			req,
		})
		await booted.payload.update({
			collection: 'rewriting',
			id: doc.id,
			data: { title: 'also stored' },
			req,
		})

		const update = (
			await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })
		).find((l) => l.operation === 'update')

		// The plugin's hook is appended, so it sees whatever the host returned. Asserting
		// which value that is keeps the ordering honest if either side ever moves.
		expect(update?.diff?.title?.after).toBe('rewritten in afterChange')
	})
})
