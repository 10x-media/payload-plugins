import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import { findDuplicates } from '../../src/index'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import type { DedupePluginOptions } from '../../src/options'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { decidePair } from '../../src/queue/pairs'
import { runScan } from '../../src/queue/scan'
import { bootDedupe, CUSTOMERS, type Doc, POSTS, pluginOptions, TEAMS } from './fixtures'

/** What the search finds and what it costs: the live check, the scan, the key index. */
describeForDb('dedupe search', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	const ctx = () => getContext(fixture.booted.payload)
	const col = (slug: CollectionSlug) => getCollectionContext(fixture.booted.payload, slug)
	/** The pairs of a document of `target`: in SQL another collection reuses the same ids. */
	const pairsOf = async (target: CollectionSlug, id: number | string, req?: PayloadRequest) =>
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
				req,
			})
		).docs as unknown as { docA: string; docB: string; status: string }[]
	/** Calls of `db.find` on one collection while `run` runs. */
	const findsOn = async (collection: string, run: () => Promise<unknown>) => {
		const spy = vi.spyOn(fixture.booted.payload.db, 'find')
		try {
			await run()
			return spy.mock.calls.filter(([args]) => args.collection === collection).length
		} finally {
			spy.mockRestore()
		}
	}

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('finds a look-alike by a rare key even when a crowded key fills the candidate limit', async () => {
		n++
		const match = col(CUSTOMERS).options.match as { candidateLimit: number }
		const limit = match.candidateLimit
		match.candidateLimit = 3
		try {
			const phone = `099${String(n).padStart(7, '0')}`
			const original = await fixture.customer({
				email: `s1.${n}@search.test`,
				name: `Anna Crowd${n}`,
				phone,
			})
			for (let i = 0; i < 5; i++) {
				await fixture.customer({
					email: `s2.${n}${i}@search.test`,
					name: `Anna Crowd${n}`,
					phone: `066${n}${i}000000`.slice(0, 10),
				})
			}
			const copy = await fixture.customer({
				email: `s3.${n}@search.test`,
				name: `Anna Crowd${n}`,
				phone: `+38${phone}`,
			})
			const pairs = await pairsOf(CUSTOMERS, copy.id)
			expect(pairs.map((pair) => [pair.docA, pair.docB].sort())).toContainEqual(
				[String(original.id), String(copy.id)].sort()
			)
		} finally {
			match.candidateLimit = limit
		}
	})

	it('looks up no stored pair for two documents that do not match', async () => {
		n++
		await fixture.customer({
			email: `s4.${n}@search.test`,
			name: `Olga Scan${n}`,
			birthDate: '1970-01-01',
		})
		await fixture.customer({
			email: `s5.${n}@search.test`,
			name: `Oleg Scan${n}`,
			birthDate: '1980-05-05',
		})
		const pairFinds = await findsOn(PAIRS_SLUG, () =>
			runScan({ req: fixture.req, ctx: ctx(), col: col(CUSTOMERS) })
		)
		const stored = await fixture.booted.payload.db.count({
			collection: PAIRS_SLUG,
			where: { target: { equals: 'customers' } },
		})
		// One look-up per pair that matched, not one per pair compared.
		expect(pairFinds).toBeLessThanOrEqual(stored.totalDocs)
	})

	it('deletes and counts the pairs a scan no longer finds', async () => {
		n++
		const a = await fixture.customer({
			email: `s6.${n}@search.test`,
			name: `Stale Pair${n}`,
			phone: `07711${n}2233`,
		})
		const b = await fixture.customer({
			email: `s7.${n}@search.test`,
			name: `Stale Pair${n}`,
			phone: `+3807711${n}2233`,
		})
		expect((await pairsOf(CUSTOMERS, a.id)).some((pair) => pair.status === 'open')).toBe(true)
		// Written past the plugin's hooks, as an import would: the pair no longer holds.
		await fixture.booted.payload.update({
			collection: CUSTOMERS,
			id: b.id,
			data: { name: 'Entirely Different', phone: '0000000000' } as never,
			context: { dedupe: { operation: 'import' } },
		})
		const summary = await runScan({ req: fixture.req, ctx: ctx(), col: col(CUSTOMERS) })
		expect(summary.removed).toBeGreaterThanOrEqual(1)
		expect((await pairsOf(CUSTOMERS, a.id)).some((pair) => pair.status === 'open')).toBe(false)
	})

	it('finds look-alikes of unsaved values from code, best first, and stores nothing', async () => {
		n++
		const saved = await fixture.customer({
			email: `fd.${n}@search.test`,
			name: `Find Me${n}`,
			phone: `04477${n}1122`,
			tenant: 'north',
		})
		const pairs = async () =>
			(await fixture.booted.payload.db.count({ collection: PAIRS_SLUG })).totalDocs
		const before = await pairs()
		const found = await findDuplicates({
			req: fixture.req,
			collection: CUSTOMERS,
			doc: { name: `Find Me${n}`, phone: `04477${n}1122`, tenant: 'north' },
		})
		expect(found[0]?.doc.id).toEqual(saved.id)
		expect(found[0]?.score).toBeGreaterThan(0.35)
		expect(found.map(({ score }) => score)).toEqual(
			found.map(({ score }) => score).sort((x, y) => y - x)
		)
		expect(await pairs()).toBe(before)
	})

	it("takes a threshold of its own, above or below the collection's", async () => {
		n++
		const name = `Threshold Person${n}`
		const phone = `04466${n}3344`
		const saved = await fixture.customer({
			email: `ms.${n}@search.test`,
			name,
			phone,
			tenant: 'north',
		})
		const ids = async (doc: Record<string, unknown>, minScore?: number) =>
			(
				await findDuplicates({
					req: fixture.req,
					collection: CUSTOMERS,
					doc: { ...doc, tenant: 'north' },
					...(minScore === undefined ? {} : { minScore }),
				})
			).map((found) => found.doc.id)
		// The name alone scores 40 of 145, under the collection's 0.35; with the phone, 75 of 145.
		expect(await ids({ name })).not.toContain(saved.id)
		expect(await ids({ name }, 0.2)).toContain(saved.id)
		expect(await ids({ name, phone })).toContain(saved.id)
		expect(await ids({ name, phone }, 0.6)).not.toContain(saved.id)
	})

	it('refuses a threshold outside 0 to 1', async () => {
		await expect(
			findDuplicates({ req: fixture.req, collection: CUSTOMERS, doc: { name: 'x' }, minScore: 2 })
		).rejects.toMatchObject({ status: 400 })
	})

	it('leaves out a candidate of another tenant, whatever the adapter answers', async () => {
		n++
		const north = await fixture.customer({
			email: `s9.${n}@search.test`,
			name: `Tenant Mix${n}`,
			phone: `04411${n}5566`,
			tenant: 'north',
		})
		const adapter = col(CUSTOMERS).adapter
		const findCandidates = adapter.findCandidates
		adapter.findCandidates = async () => [{ id: String(north.id) }]
		try {
			const south = await fixture.customer({
				email: `s10.${n}@search.test`,
				name: `Tenant Mix${n}`,
				phone: `04411${n}5566`,
				tenant: 'south',
			})
			expect(await pairsOf(CUSTOMERS, south.id)).toEqual([])
		} finally {
			adapter.findCandidates = findCandidates
		}
	})

	it('drops a document taken off publication from the index, so it pairs with nothing', async () => {
		n++
		const create = (title: string) =>
			fixture.booted.payload.create({
				collection: POSTS,
				data: { title, _status: 'published' } as never,
			}) as Promise<Doc>
		const first = await create(`Unpublished Twin ${n}`)
		await fixture.booted.payload.update({
			collection: POSTS,
			id: first.id,
			data: { _status: 'draft' } as never,
		})
		expect(await fixture.keysFor(first.id, 'posts')).toEqual([])
		const second = await create(`Unpublished Twin ${n}`)
		expect(await pairsOf(POSTS, second.id)).toEqual([])
	})

	it('closes the open pairs of a document taken off publication, its not-duplicates marks kept', async () => {
		n++
		const create = (title: string) =>
			fixture.booted.payload.create({
				collection: POSTS,
				data: { title, _status: 'published' } as never,
			}) as Promise<Doc>
		const first = await create(`Withdrawn Twin ${n}`)
		const second = await create(`Withdrawn Twin ${n}`)
		await create(`Withdrawn Twin ${n}`)
		const apart = (await pairsOf(POSTS, first.id)).find(
			(pair) => pair.docA === String(second.id) || pair.docB === String(second.id)
		)
		await decidePair({ req: fixture.req, ctx: ctx(), pair: apart as never, status: 'dismissed' })
		await fixture.booted.payload.update({
			collection: POSTS,
			id: first.id,
			data: { _status: 'draft' } as never,
		})
		expect((await pairsOf(POSTS, first.id)).map((pair) => pair.status)).toEqual(['dismissed'])
	})

	/** A request inside a transaction of its own, which the test commits or rolls back. */
	const inTransaction = async () => {
		const id = await fixture.booted.payload.db.beginTransaction()
		return { req: { ...fixture.req, transactionID: id ?? undefined } as typeof fixture.req, id }
	}

	it('leaves no pair behind a save that rolls back', async () => {
		const twin = { name: 'Rolled Twin', phone: '+49 151 9090901', birthDate: '1990-01-21' }
		const kept = await fixture.customer({ ...twin, email: 'rolled.a@search.test' })
		const { req, id } = await inTransaction()
		await fixture.booted.payload.create({
			collection: CUSTOMERS,
			data: { ...twin, email: 'rolled.b@search.test' } as never,
			req,
			depth: 0,
		})
		expect(await pairsOf(CUSTOMERS, kept.id, req), 'the save found its twin').toHaveLength(1)
		await fixture.booted.payload.db.rollbackTransaction(id as never)
		expect(await pairsOf(CUSTOMERS, kept.id)).toEqual([])
	})

	it('saves a look-alike in the transaction that moved its twin to the trash', async () => {
		const twin = { name: 'Held Twin', phone: '+49 151 8080801', birthDate: '1991-02-22' }
		const trashed = await fixture.customer({ ...twin, email: 'held.a@search.test' })
		const saved = await fixture.customer({ ...twin, email: 'held.b@search.test' })
		const { req, id } = await inTransaction()
		const update = (docId: number | string, data: Record<string, unknown>) =>
			fixture.booted.payload.update({
				collection: CUSTOMERS,
				id: docId,
				data: data as never,
				req,
				depth: 0,
			})
		await update(trashed.id, { deletedAt: new Date().toISOString() })
		const outcome = await Promise.race([
			update(saved.id, { email: 'held.b2@search.test' }).then(() => 'saved'),
			new Promise((resolve) => setTimeout(() => resolve('waiting'), 10_000)),
		])
		await fixture.booted.payload.db.rollbackTransaction(id as never)
		expect(outcome).toBe('saved')
	}, 30_000)

	it('keeps a published document in the index while a draft of it is saved', async () => {
		n++
		const create = (title: string) =>
			fixture.booted.payload.create({
				collection: POSTS,
				data: { title, _status: 'published' } as never,
			}) as Promise<Doc>
		const first = await create(`Drafted Twin ${n}`)
		await fixture.booted.payload.update({
			collection: POSTS,
			id: first.id,
			draft: true,
			data: { title: `Drafted Twin ${n}` } as never,
		})
		const second = await create(`Drafted Twin ${n}`)
		expect(await pairsOf(POSTS, second.id)).toHaveLength(1)
	})

	it('writes no key rows when a save leaves the match fields as they were', async () => {
		n++
		const doc = await fixture.customer({
			email: `s11.${n}@search.test`,
			name: `Same Keys${n}`,
			phone: `03311${n}7788`,
		})
		const spy = vi.spyOn(fixture.booted.payload.db, 'create')
		try {
			await fixture.booted.payload.update({
				collection: CUSTOMERS,
				id: doc.id,
				data: { note: 'a note, not a match field' } as never,
			})
			expect(spy.mock.calls.filter(([args]) => args.collection === KEYS_SLUG)).toEqual([])
		} finally {
			spy.mockRestore()
		}
	})

	it('reads the stored pairs of a save in one query, however many look-alikes it has', async () => {
		n++
		for (let i = 0; i < 3; i++) {
			await fixture.customer({
				email: `batch${i}.${n}@search.test`,
				name: `Nina Batch${n}`,
				phone: `02211${n}4455`,
			})
		}
		const pairFinds = await findsOn(PAIRS_SLUG, () =>
			fixture.customer({
				email: `batch9.${n}@search.test`,
				name: `Nina Batch${n}`,
				phone: `02211${n}4455`,
			})
		)
		expect(pairFinds).toBeLessThanOrEqual(1)
	})

	it('merges rows that hold rows of their own, which the database keys by id', async () => {
		const team = (person: string, number: string) =>
			fixture.booted.payload.create({
				collection: TEAMS,
				data: { name: 'Team', members: [{ person, phones: [{ number }] }] } as never,
				depth: 0,
			}) as Promise<Doc>
		const primary = await team('Ann', '111')
		const other = await team('Bob', '222')
		await applyMerge({
			req: fixture.req,
			ctx: ctx(),
			col: col(TEAMS),
			survivorId: primary.id,
			absorbedIds: [other.id],
			choices: {
				members: {
					items: [
						{ doc: String(primary.id), index: 0 },
						{ doc: String(other.id), index: 0 },
					],
				},
			},
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: primary.id,
			depth: 0,
		})) as unknown as { members: { person: string; phones: { number: string }[] }[] }
		expect(merged.members.map((member) => [member.person, member.phones[0]?.number])).toEqual([
			['Ann', '111'],
			['Bob', '222'],
		])
	})

	it('takes a localized group whole from another document, the rows in it included', async () => {
		const primary = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Carded', card: { title: 'Mine' } } as never,
			depth: 0,
		})) as Doc
		const other = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Carded', card: { title: 'Theirs', lines: [{ text: 'line' }] } } as never,
			depth: 0,
		})) as Doc
		await applyMerge({
			req: fixture.req,
			ctx: ctx(),
			col: col(TEAMS),
			survivorId: primary.id,
			absorbedIds: [other.id],
			choices: { 'card@en': { doc: String(other.id) } },
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: primary.id,
			depth: 0,
		})) as unknown as { card: { title: string; lines: { text: string }[] } }
		expect(merged.card.title).toBe('Theirs')
		expect(merged.card.lines.map((line) => line.text)).toEqual(['line'])
	})

	it('lets go of a unique value in the rows of a localized group the survivor takes', async () => {
		const primary = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Badged', card: { title: 'Mine' } } as never,
			depth: 0,
		})) as Doc
		const other = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Badged', card: { title: 'Theirs', lines: [{ badge: 'B-1' }] } } as never,
			depth: 0,
		})) as Doc
		await applyMerge({
			req: fixture.req,
			ctx: ctx(),
			col: col(TEAMS),
			survivorId: primary.id,
			absorbedIds: [other.id],
			choices: { 'card@en': { doc: String(other.id) } },
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: primary.id,
			depth: 0,
		})) as unknown as { card: { lines: { badge: string }[] } }
		expect(merged.card.lines.map((line) => line.badge)).toEqual(['B-1'])
	})

	it('fills a localized group the primary left empty from the other document', async () => {
		const primary = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Blank card' } as never,
			depth: 0,
		})) as Doc
		const other = (await fixture.booted.payload.create({
			collection: TEAMS,
			data: { name: 'Blank card', card: { title: 'Theirs' } } as never,
			depth: 0,
		})) as Doc
		const plan = await buildPlanResponse({
			req: fixture.req,
			ctx: ctx(),
			col: col(TEAMS),
			survivorId: primary.id,
			absorbedIds: [other.id],
			choices: {},
		})
		expect(plan.decisions.find((entry) => entry.key === 'card@en')).toMatchObject({
			source: String(other.id),
			auto: true,
			conflict: false,
		})
	})

	it('merges rows of a block the config names, whose rows hold rows too', async () => {
		const team = (label: string) =>
			fixture.booted.payload.create({
				collection: TEAMS,
				data: { name: 'Board', boards: [{ blockType: 'roster', seats: [{ label }] }] } as never,
				depth: 0,
			}) as Promise<Doc>
		const primary = await team('front')
		const other = await team('back')
		await applyMerge({
			req: fixture.req,
			ctx: ctx(),
			col: col(TEAMS),
			survivorId: primary.id,
			absorbedIds: [other.id],
			choices: {
				boards: {
					items: [
						{ doc: String(primary.id), index: 0 },
						{ doc: String(other.id), index: 0 },
					],
				},
			},
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: primary.id,
			depth: 0,
		})) as unknown as { boards: { seats: { label: string }[] }[] }
		expect(merged.boards.map((board) => board.seats[0]?.label)).toEqual(['front', 'back'])
	})
})

/** `checkOnSave: false` turns off the pairs a save writes, not the index the search reads. */
describeForDb('dedupe search without the check on save', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	const post = (title: string) =>
		fixture.booted.payload.create({
			collection: POSTS,
			data: { title, _status: 'published' } as never,
		}) as Promise<Doc>

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				posts: { match: { fields: [{ path: 'title', weight: 1 }] }, checkOnSave: false },
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('indexes a saved document, so the search finds it before any scan, and stores no pair', async () => {
		const first = await post('Quiet Twin')
		const second = await post('Quiet Twin')
		expect(await fixture.keysFor(first.id, POSTS)).not.toEqual([])
		const found = await findDuplicates({
			req: fixture.req,
			collection: POSTS,
			doc: { title: 'Quiet Twin' },
		})
		expect(found.map(({ doc }) => doc.id)).toEqual(expect.arrayContaining([first.id, second.id]))
		const pairs = await fixture.booted.payload.db.count({
			collection: PAIRS_SLUG,
			where: { target: { equals: POSTS } },
		})
		expect(pairs.totalDocs).toBe(0)
	})

	it('drops a document taken off publication from the index', async () => {
		const doc = await post('Quiet Unpublished')
		expect(await fixture.keysFor(doc.id, POSTS)).not.toEqual([])
		await fixture.booted.payload.update({
			collection: POSTS,
			id: doc.id,
			data: { _status: 'draft' } as never,
		})
		expect(await fixture.keysFor(doc.id, POSTS)).toEqual([])
	})
})

/** The keys adapter asked for candidates: one read per key, side by side outside a transaction. */
describeForDb('dedupe search, names with typos', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	const customers = pluginOptions.collections?.customers as Exclude<
		NonNullable<DedupePluginOptions['collections']>[string],
		boolean | undefined
	>

	beforeAll(async () => {
		const fields = customers.match?.fields ?? []
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				customers: {
					...customers,
					match: {
						...customers.match,
						fields: fields.map((field) =>
							field.path === 'name' ? { ...field, typos: true } : field
						),
					},
				},
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	/** The most key reads `run` has waiting at the same moment, and what it returned. */
	const keyReadsAtOnce = async <T>(run: () => Promise<T>): Promise<[number, T]> => {
		const { db: adapter } = fixture.booted.payload
		const find = adapter.find.bind(adapter)
		let reading = 0
		let most = 0
		const spy = vi.spyOn(adapter, 'find').mockImplementation(async (args) => {
			if (args.collection !== KEYS_SLUG) return find(args)
			most = Math.max(most, ++reading)
			try {
				return await find(args)
			} finally {
				reading--
			}
		})
		try {
			const value = await run()
			return [most, value]
		} finally {
			spy.mockRestore()
		}
	}
	const found = (req: typeof fixture.req, name: string) =>
		findDuplicates({
			req,
			collection: CUSTOMERS,
			doc: { name, tenant: 'typos' },
			minScore: 0.1,
		}).then((list) => list.map((one) => String(one.doc.id)).sort())

	it('finds a name with a slip early in every word, reading its keys side by side', async () => {
		const john = await fixture.customer({ name: 'John Smith', tenant: 'typos' })
		const [atOnce, ids] = await keyReadsAtOnce(() => found(fixture.req, 'Jhon Smtih'))
		expect(ids).toEqual([String(john.id)])
		expect(atOnce).toBeGreaterThan(1)
	})

	it('reads the keys one after another inside a transaction, and finds the same', async () => {
		await fixture.customer({ name: 'Anna Kowalska', tenant: 'typos' })
		await fixture.customer({ name: 'Anna Kovalska', tenant: 'typos' })
		const inTransaction = Object.assign(Object.create(fixture.req), { transactionID: 'held' })
		const [atOnce, ids] = await keyReadsAtOnce(() => found(inTransaction, 'Anna Kowalska'))
		expect(atOnce).toBe(1)
		expect(ids).toEqual((await keyReadsAtOnce(() => found(fixture.req, 'Anna Kowalska')))[1])
		expect(ids).toHaveLength(2)
	})
})
