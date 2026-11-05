import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { itemRefsOf, resolveItemLabels } from './itemLabels'
import { setRuntime } from './runtime'

interface FindArgs {
	collection: string
	where: { id: { in: string[] } }
	select?: Record<string, boolean>
	depth?: number
	pagination?: boolean
	overrideAccess?: boolean
	user?: unknown
}

type Doc = Record<string, unknown>

const STORE: Record<string, Doc[]> = {
	offers: [
		{ id: '1', title: 'Spring sale' },
		{ id: '2', title: 'Hidden offer' },
		{ id: 'a:b', title: '  ' },
	],
	banners: [{ id: '9', heading: 'Welcome' }],
}

interface Setup {
	/** Throws for every lookup, as a database that is down does. */
	fail?: boolean
	/** Throws for a lookup naming any id this refuses, as a database casting ids does. */
	refuses?: (id: string) => boolean
	db?: { name: string; defaultIDType: 'number' | 'text'; idType?: string }
	collections?: Record<string, { customIDType?: 'number' | 'text'; useAsTitle?: string }>
	store?: Record<string, Doc[]>
}

/** A Payload whose `find` answers as this reader may see: offer 2 is closed to them. */
const requestFor = (setup: Setup = {}) => {
	const user = { id: 'editor' }
	const store = setup.store ?? STORE
	const find = vi.fn(async (args: FindArgs) => {
		if (setup.fail || args.where.id.in.some((id) => setup.refuses?.(id))) {
			throw new Error('database down')
		}
		const docs = (store[args.collection] ?? []).filter(
			(doc) =>
				args.where.id.in.includes(String(doc.id)) &&
				!(args.overrideAccess === false && doc.id === '2')
		)
		return { docs }
	})
	const warn = vi.fn()
	const collections = setup.collections ?? {
		offers: { customIDType: 'text', useAsTitle: 'title' },
		banners: { customIDType: 'text' },
		pages: { customIDType: 'text', useAsTitle: 'title' },
	}
	const payload = {
		db: setup.db ?? { name: 'mongoose', defaultIDType: 'text' },
		collections: Object.fromEntries(
			Object.entries(collections).map(([slug, { customIDType, useAsTitle }]) => [
				slug,
				{
					...(customIDType ? { customIDType } : {}),
					config: { admin: useAsTitle ? { useAsTitle } : {} },
				},
			])
		),
		find,
		logger: { warn },
	} as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([memoryAdapter()]),
		configAdapterIds: new Set(),
		bindings: {
			offers: { item: true, scopeField: false },
			banners: { item: true, scopeField: false },
			pages: { pathField: 'slug', scopeField: false },
		},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: false,
	})
	return { req: { payload, user } as unknown as PayloadRequest, find, warn, user }
}

describe('resolveItemLabels', () => {
	it("names each item by its collection's title field, read with the reader's own access", async () => {
		const { req, find, user } = requestFor()
		const labels = await resolveItemLabels(req, ['offers:1'])
		expect(labels).toEqual({ 'offers:1': 'Spring sale' })
		expect(find).toHaveBeenCalledWith(
			expect.objectContaining({ collection: 'offers', overrideAccess: false, user })
		)
	})

	it('reads the title field alone, flat and unpaginated', async () => {
		const { req, find } = requestFor()
		await resolveItemLabels(req, ['offers:1', 'banners:9'])
		expect(find).toHaveBeenCalledWith(
			expect.objectContaining({
				collection: 'offers',
				select: { title: true },
				depth: 0,
				pagination: false,
			})
		)
		expect(find).toHaveBeenCalledWith(
			expect.objectContaining({ collection: 'banners', select: { id: true } })
		)
	})

	it('asks once per collection, however many items it names', async () => {
		const { req, find } = requestFor()
		await resolveItemLabels(req, ['offers:1', 'offers:2', 'banners:9'])
		expect(find).toHaveBeenCalledTimes(2)
	})

	it('answers null for an item the reader may not open, or one that is gone', async () => {
		const { req } = requestFor()
		const labels = await resolveItemLabels(req, ['offers:2', 'offers:404'])
		expect(labels).toEqual({ 'offers:2': null, 'offers:404': null })
	})

	it('answers null for a collection not bound as items, and for anything not a ref', async () => {
		const { req, find } = requestFor()
		const labels = await resolveItemLabels(req, ['pages:1', 'nope', 'users:1'])
		expect(labels).toEqual({ 'pages:1': null, nope: null, 'users:1': null })
		expect(find).not.toHaveBeenCalled()
	})

	it('falls back to the document id where the title is empty or there is no title field', async () => {
		const { req } = requestFor()
		const labels = await resolveItemLabels(req, ['offers:a%3Ab', 'banners:9'])
		expect(labels).toEqual({ 'offers:a%3Ab': 'a:b', 'banners:9': '9' })
	})

	it('shows a failed lookup as hidden, and says why in the log', async () => {
		const { req, warn } = requestFor({ fail: true })
		expect(await resolveItemLabels(req, ['offers:1'])).toEqual({ 'offers:1': null })
		expect(warn).toHaveBeenCalledOnce()
	})

	// A casting database fails the whole query, so a forged `offers:x` would blank every title.
	it('never asks about an id no document of the collection could have', async () => {
		const { req, find } = requestFor({
			db: { name: 'postgres', defaultIDType: 'number', idType: 'serial' },
			collections: { offers: { useAsTitle: 'title' } },
			refuses: (id) => !/^\d+$/.test(id),
		})
		const labels = await resolveItemLabels(req, ['offers:1', 'offers:x', 'offers:1.5'])
		expect(labels).toEqual({ 'offers:1': 'Spring sale', 'offers:x': null, 'offers:1.5': null })
		expect(find).toHaveBeenCalledOnce()
		expect(find.mock.calls[0]?.[0].where.id.in).toEqual(['1'])
	})

	it('skips an id that is no ObjectId on Mongo, and a malformed uuid on Postgres', async () => {
		const objectId = '65f0c0ffee0123456789abcd'
		const mongo = requestFor({
			collections: { offers: { useAsTitle: 'title' } },
			store: { offers: [{ id: objectId, title: 'Spring sale' }] },
			refuses: (id) => !/^[0-9a-f]{24}$/.test(id),
		})
		expect(await resolveItemLabels(mongo.req, [`offers:${objectId}`, 'offers:x'])).toEqual({
			[`offers:${objectId}`]: 'Spring sale',
			'offers:x': null,
		})
		const uuid = '0b4f6a9e-3c1d-4e7a-9b2f-8d6c5e4a3b21'
		const postgres = requestFor({
			db: { name: 'postgres', defaultIDType: 'text', idType: 'uuid' },
			collections: { offers: { useAsTitle: 'title' } },
			store: { offers: [{ id: uuid, title: 'Spring sale' }] },
			refuses: (id) => id !== uuid,
		})
		expect(await resolveItemLabels(postgres.req, [`offers:${uuid}`, 'offers:42'])).toEqual({
			[`offers:${uuid}`]: 'Spring sale',
			'offers:42': null,
		})
	})

	it('never lets one id the database refuses blank the others', async () => {
		const { req, warn } = requestFor({ refuses: (id) => id === '2' })
		const labels = await resolveItemLabels(req, ['offers:1', 'offers:2', 'offers:a%3Ab'])
		expect(labels).toEqual({ 'offers:1': 'Spring sale', 'offers:2': null, 'offers:a%3Ab': 'a:b' })
		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain('1 of 3')
	})

	it('stops asking id by id once the database refuses every one of them', async () => {
		const { req, find, warn } = requestFor({ fail: true })
		const refs = ['offers:1', 'offers:2', 'offers:3', 'offers:4', 'offers:5']
		const labels = await resolveItemLabels(req, refs)
		expect(Object.values(labels)).toEqual([null, null, null, null, null])
		expect(find).toHaveBeenCalledTimes(3)
		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain('5 of 5')
	})
})

describe('itemRefsOf', () => {
	it('collects every ref a read names, once each', () => {
		const refs = itemRefsOf(
			{
				item: 'offers:1',
				filters: [
					{ dimension: 'item', operator: 'eq', value: 'offers:2' },
					{ dimension: 'country', operator: 'eq', value: 'DE' },
				],
			},
			[
				{
					rows: [
						{ dimensions: { item: 'offers:3' }, metrics: {} },
						{ dimensions: { item: 'offers:1' }, metrics: {} },
						{ dimensions: { page: '/' }, metrics: {} },
					],
					meta: { provider: 'native', fetchedAt: '' },
				},
				undefined,
			]
		)
		expect(refs).toEqual(['offers:1', 'offers:2', 'offers:3'])
	})
})
