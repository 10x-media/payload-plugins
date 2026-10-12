import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import type { CollectionDedupeOptions } from '../../src/options'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { checkDocument } from '../../src/queue/live'
import { decidePair, type PairRow } from '../../src/queue/pairs'
import { runScan } from '../../src/queue/scan'
import type { DedupeAdapter } from '../../src/search/contract'
import { bootDedupe, CUSTOMERS, POSTS, pluginOptions } from './fixtures'

/** The adapter seam: an adapter of one method, and the built-in one handed over to extend. */
describeForDb('dedupe adapter', {}, (db) => {
	const twins = (label: string) => [
		{
			name: `Olena ${label}`,
			email: `${label}.a@adapter.test`,
			phone: '0441234567',
			tenant: 'north',
		},
		{
			name: `Olena ${label}`,
			email: `${label}.b@adapter.test`,
			phone: '0441234567',
			tenant: 'north',
		},
	]

	describe('an adapter with nothing but findCandidates', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		const everyone: DedupeAdapter = {
			findCandidates: async ({ req, collection, doc }) =>
				(
					await req.payload.find({
						collection: collection as CollectionSlug,
						depth: 0,
						pagination: false,
						req,
					})
				).docs
					.filter((other) => String(other.id) !== String(doc.id))
					.map((other) => ({ id: String(other.id) })),
		}

		beforeAll(async () => {
			fixture = await bootDedupe(db, { adapter: () => everyone })
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('finds a duplicate on save and in the scan, with no key stored anywhere', async () => {
			const [a, b] = twins('solo')
			await fixture.customer(a as Record<string, unknown>)
			const second = await fixture.customer(b as Record<string, unknown>)
			expect(await fixture.pairsFor(second.id)).toHaveLength(1)

			const summary = await runScan({
				req: fixture.req,
				ctx: getContext(fixture.booted.payload),
				col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			})
			expect(summary.pairs).toBeGreaterThanOrEqual(1)
			expect(fixture.booted.payload.collections[KEYS_SLUG as CollectionSlug]).toBeUndefined()
		})

		it('counts in the scan only the pairs left open, as the scan over buckets does', async () => {
			const [a, b] = twins('counted')
			await fixture.customer(a as Record<string, unknown>)
			const second = await fixture.customer(b as Record<string, unknown>)
			const [pair] = await fixture.pairsFor(second.id)
			const ctx = getContext(fixture.booted.payload)
			await decidePair({ req: fixture.req, ctx, pair: pair as PairRow, status: 'dismissed' })

			const summary = await runScan({
				req: fixture.req,
				ctx,
				col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			})
			const open = await fixture.booted.payload.db.count({
				collection: PAIRS_SLUG,
				where: { and: [{ target: { equals: CUSTOMERS } }, { status: { equals: 'open' } }] },
			})
			expect(summary.pairs).toBe(open.totalDocs)
			// Every document of one tenant meets every other once, however many sides ask.
			const { totalDocs } = await fixture.booted.payload.count({ collection: CUSTOMERS })
			expect(summary.compared).toBe((totalDocs * (totalDocs - 1)) / 2)
		})
	})

	describe('an adapter that opens a transaction of its own in index', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		const kept: boolean[] = []
		const own: DedupeAdapter = {
			findCandidates: async () => [],
			// What initTransaction does to the request it is handed, held across a write.
			index: async ({ req, doc }) => {
				req.transactionID = `own-${String(doc.id)}`
				await new Promise((resolve) => setTimeout(resolve, 20))
				kept.push(req.transactionID === `own-${String(doc.id)}`)
				req.transactionID = undefined
			},
		}

		beforeAll(async () => {
			fixture = await bootDedupe(db, { adapter: () => own })
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('gets a request of its own for each document the scan indexes at once', async () => {
			for (const label of ['iso-a', 'iso-b', 'iso-c']) {
				await fixture.booted.payload.db.create({
					collection: CUSTOMERS,
					data: { name: { en: label }, tenant: 'north' },
					req: fixture.req,
				})
			}
			kept.length = 0
			await runScan({
				req: fixture.req,
				ctx: getContext(fixture.booted.payload),
				col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			})
			expect(kept.length).toBeGreaterThanOrEqual(3)
			expect(kept.every(Boolean)).toBe(true)
		})
	})

	describe('an adapter whose index fails for one document', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		let finished = 0
		const flaky: DedupeAdapter = {
			findCandidates: async () => [],
			index: async ({ doc }) => {
				if ((doc.name as { en?: string } | undefined)?.en === 'flaky-bad')
					throw new Error('index down')
				await new Promise((resolve) => setTimeout(resolve, 50))
				finished++
			},
		}

		beforeAll(async () => {
			fixture = await bootDedupe(db, { adapter: () => flaky })
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('stops the scan only once the documents beside it are indexed', async () => {
			for (const label of ['flaky-bad', 'flaky-a', 'flaky-b']) {
				await fixture.booted.payload.db.create({
					collection: CUSTOMERS,
					data: { name: { en: label }, tenant: 'north' },
					req: fixture.req,
				})
			}
			finished = 0
			await expect(
				runScan({
					req: fixture.req,
					ctx: getContext(fixture.booted.payload),
					col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
				})
			).rejects.toThrow('index down')
			expect(finished).toBe(2)
		})
	})

	describe('an adapter that is down, with the check run inside the save', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		const down: DedupeAdapter = {
			findCandidates: async () => {
				throw new Error('search is down')
			},
		}

		beforeAll(async () => {
			fixture = await bootDedupe(db, { adapter: () => down })
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('saves the document and logs the failed check', async () => {
			const logged = vi.spyOn(fixture.booted.payload.logger, 'error')
			try {
				const [a] = twins('down')
				const saved = await fixture.customer(a as Record<string, unknown>)
				expect(saved.id).toBeDefined()
				expect(logged).toHaveBeenCalledWith(
					expect.objectContaining({ err: expect.objectContaining({ message: 'search is down' }) }),
					expect.any(String)
				)
			} finally {
				logged.mockRestore()
			}
		})
	})

	describe('an adapter that finds a pair from one of its documents only', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		const older: DedupeAdapter = {
			findCandidates: async ({ req, collection, doc }) =>
				(
					await req.payload.find({
						collection: collection as CollectionSlug,
						depth: 0,
						pagination: false,
						req,
					})
				).docs
					.filter((other) => String(other.createdAt) < String(doc.createdAt))
					.map((other) => ({ id: String(other.id) })),
		}

		beforeAll(async () => {
			fixture = await bootDedupe(db, { adapter: () => older })
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('counts each pair of the scan once, in whole numbers', async () => {
			const [a, b] = twins('oneway')
			await fixture.customer(a as Record<string, unknown>)
			await fixture.customer(b as Record<string, unknown>)

			const summary = await runScan({
				req: fixture.req,
				ctx: getContext(fixture.booted.payload),
				col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			})
			const open = await fixture.booted.payload.db.count({
				collection: PAIRS_SLUG,
				where: { and: [{ target: { equals: CUSTOMERS } }, { status: { equals: 'open' } }] },
			})
			expect(open.totalDocs).toBe(1)
			expect(summary.pairs).toBe(1)
			expect(summary.compared).toBe(1)
		})
	})

	describe('the built-in adapter handed to the factory', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		let received: DedupeAdapter | undefined
		const asked: string[] = []

		beforeAll(async () => {
			fixture = await bootDedupe(db, {
				adapter: (keys) => {
					received = keys
					return {
						...keys,
						findCandidates: async (args) => {
							asked.push(String(args.doc.id))
							return keys.findCandidates(args)
						},
					}
				},
			})
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it('is the keys adapter, and spread into another it still indexes and finds duplicates', async () => {
			expect(received?.scanBuckets).toBeTypeOf('function')
			expect(received?.register).toBeTypeOf('function')
			const [a, b] = twins('spread')
			await fixture.customer(a as Record<string, unknown>)
			const second = await fixture.customer(b as Record<string, unknown>)
			expect(asked).toContain(String(second.id))
			expect(await fixture.pairsFor(second.id)).toHaveLength(1)
			expect(await fixture.keysFor(second.id)).not.toHaveLength(0)
		})
	})

	describe('an adapter on one collection', () => {
		let fixture: Awaited<ReturnType<typeof bootDedupe>>
		let pluginLevel: DedupeAdapter | undefined
		let handed: DedupeAdapter | undefined
		const everyone: DedupeAdapter = {
			findCandidates: async ({ req, collection, doc }) =>
				(
					await req.payload.find({
						collection: collection as CollectionSlug,
						depth: 0,
						pagination: false,
						req,
					})
				).docs
					.filter((other) => String(other.id) !== String(doc.id))
					.map((other) => ({ id: String(other.id) })),
		}
		// Ids repeat across tables in SQL, so a pair is looked up within its collection.
		const pairsIn = async (target: string, id: number | string) =>
			(
				await fixture.booted.payload.db.find({
					collection: PAIRS_SLUG,
					where: {
						and: [
							{ target: { equals: target } },
							{ or: [{ docA: { equals: String(id) } }, { docB: { equals: String(id) } }] },
						],
					},
					pagination: false,
				})
			).docs

		beforeAll(async () => {
			fixture = await bootDedupe(db, {
				adapter: (keys) => {
					pluginLevel = { ...keys }
					return pluginLevel
				},
				collections: {
					...pluginOptions.collections,
					customers: {
						...(pluginOptions.collections?.customers as CollectionDedupeOptions),
						adapter: (base) => {
							handed = base
							return everyone
						},
					},
				},
			})
		})

		afterAll(async () => {
			await fixture.booted.stop()
		})

		it("is handed the plugin's adapter to extend", () => {
			expect(handed).toBe(pluginLevel)
		})

		it('finds the duplicates of its collection and stores no key for it', async () => {
			const [a, b] = twins('own')
			await fixture.customer(a as Record<string, unknown>)
			const second = await fixture.customer(b as Record<string, unknown>)
			expect(await pairsIn(CUSTOMERS, second.id)).toHaveLength(1)
			expect(await fixture.keysFor(second.id, CUSTOMERS)).toEqual([])
		})

		it("leaves the other collections on the plugin's adapter", async () => {
			const create = (title: string) =>
				fixture.booted.payload.create({
					collection: POSTS,
					data: { title, _status: 'published' } as never,
				}) as Promise<{ id: number | string }>
			const first = await create('Shared Adapter Twin')
			const second = await create('Shared Adapter Twin')
			expect(await fixture.keysFor(first.id, POSTS)).not.toEqual([])
			expect(await pairsIn(POSTS, second.id)).toHaveLength(1)
		})
	})
})

/** An adapter whose buckets ignore the tenant, as a search engine's would unless told. */
describeForDb('dedupe scan with buckets across tenants', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	const everyone = async (req: Parameters<DedupeAdapter['findCandidates']>[0]['req']) =>
		(
			await req.payload.find({
				collection: CUSTOMERS,
				depth: 0,
				pagination: false,
				where: { email: { like: 'tenants.test' } },
				req,
			})
		).docs.map((doc) => String(doc.id))
	const adapter: DedupeAdapter = {
		findCandidates: async ({ req }) => (await everyone(req)).map((id) => ({ id })),
		scanBuckets: async ({ req }) => ({
			buckets: [{ key: 'all', ids: await everyone(req) }],
			nextCursor: null,
			oversized: [],
		}),
	}

	beforeAll(async () => {
		fixture = await bootDedupe(db, { adapter: () => adapter })
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('pairs no two tenants in a scan, as the check on save does not', async () => {
		const twin = (tenant: string) =>
			fixture.customer({
				name: 'Ivan Tenant',
				email: `ivan.${tenant}@tenants.test`,
				phone: '0441110000',
				tenant,
			})
		const north = await twin('north')
		const south = await twin('south')
		const ctx = getContext(fixture.booted.payload)
		const col = getCollectionContext(fixture.booted.payload, CUSTOMERS)
		expect((await checkDocument({ req: fixture.req, ctx, col, doc: south })).open).toEqual([])
		await runScan({ req: fixture.req, ctx, col })
		expect(await fixture.pairsFor(north.id)).toHaveLength(0)
	})
})
