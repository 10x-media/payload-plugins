import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import { findDuplicates } from '../../src/index'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { runScan } from '../../src/queue/scan'
import { bootDedupe, CUSTOMERS, type Doc, POSTS, TEAMS } from './fixtures'

/** What the search finds and what it costs: the live check, the scan, the key index. */
describeForDb('dedupe search', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	const ctx = () => getContext(fixture.booted.payload)
	const col = (slug: CollectionSlug) => getCollectionContext(fixture.booted.payload, slug)
	const pairsOf = async (id: number | string) =>
		(
			await fixture.booted.payload.db.find({
				collection: PAIRS_SLUG,
				where: { or: [{ docA: { equals: String(id) } }, { docB: { equals: String(id) } }] },
				pagination: false,
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
			const pairs = await pairsOf(copy.id)
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

	it('counts the pairs a scan marks stale', async () => {
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
		expect((await pairsOf(a.id)).some((pair) => pair.status === 'open')).toBe(true)
		// Written past the plugin's hooks, as an import would: the pair no longer holds.
		await fixture.booted.payload.update({
			collection: CUSTOMERS,
			id: b.id,
			data: { name: 'Entirely Different', phone: '0000000000' } as never,
			context: { dedupe: { operation: 'import' } },
		})
		const summary = await runScan({ req: fixture.req, ctx: ctx(), col: col(CUSTOMERS) })
		expect(summary.stale).toBeGreaterThanOrEqual(1)
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
			expect(await pairsOf(south.id)).toEqual([])
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
		expect(await pairsOf(second.id)).toEqual([])
	})

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
		expect(await pairsOf(second.id)).toHaveLength(1)
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
