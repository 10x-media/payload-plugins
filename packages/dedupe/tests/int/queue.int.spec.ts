import { describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type Endpoint, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PAIRS_SLUG } from '../../src/collections/slugs'
import { pairKeyFor } from '../../src/match/keys'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { findPairByKey, type QueueResponse, readQueue } from '../../src/queue/pairs'
import type { ScanSummary } from '../../src/queue/scan'
import { bootDedupe, type Doc, LEADS, reqFor, VAULTS } from './fixtures'

describeForDb('dedupe queue', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	const call = async (path: string, extra: Partial<PayloadRequest>): Promise<unknown> => {
		const endpoint = (fixture.booted.payload.config.endpoints as Endpoint[]).find(
			(entry) => entry.path === path
		) as Endpoint
		const req = Object.assign(Object.create(fixture.req), extra) as PayloadRequest
		const response = await endpoint.handler(req)
		expect(response.status).toBe(200)
		return response.json()
	}

	const queue = (collection: string | null) =>
		readQueue({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			collection,
			status: 'open',
			page: 1,
			limit: 25,
		})

	const pairRow = (target: string, [a, b]: [Doc, Doc], score = 0.5) =>
		fixture.booted.payload.db.create({
			collection: PAIRS_SLUG,
			data: {
				target,
				pairKey: pairKeyFor(target, a.id, b.id),
				docA: String(a.id),
				docB: String(b.id),
				score,
				status: 'open',
			},
		})
	/** The queue rows that hold this document. */
	const rowsWith = (result: QueueResponse, doc: Doc) =>
		result.docs.filter((row) => row.docs.some((entry) => entry.id === String(doc.id)))

	beforeAll(async () => {
		fixture = await bootDedupe(db)
		const { booted, customer } = fixture
		await customer({ name: 'Queue Person', email: 'queue@mail.com', phone: '0151 2345 6789' })
		await customer({ name: 'Queue Person', email: 'queue.p@mail.com', phone: '+49 151 2345 6789' })
		const lead = (email: string) =>
			booted.payload.create({ collection: LEADS, data: { email } as never }) as Promise<Doc>
		await pairRow('leads', [await lead('lead-a@mail.com'), await lead('lead-b@mail.com')])
		await pairRow('gone', [await lead('x@mail.com'), await lead('y@mail.com')])
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	describe('without a collection', () => {
		it('lists the pairs of every configured collection', async () => {
			const result = await queue(null)
			expect(result.docs.map((pair) => pair.collection).sort()).toEqual(['customers', 'leads'])
			expect(result.counts.open).toBe(2)
		})

		it('resolves each pair against its own collection', async () => {
			const result = await queue(null)
			const lead = result.docs.find((row) => row.collection === 'leads')
			expect(lead?.docs.map((doc) => doc.title).sort()).toEqual([
				'lead-a@mail.com',
				'lead-b@mail.com',
			])
		})
	})

	it('lists a collection without a tenant field whichever tenant is selected', async () => {
		const req = Object.assign(Object.create(fixture.req), {
			headers: new Headers({ cookie: 'payload-tenant=north' }),
		}) as PayloadRequest
		const result = await readQueue({
			req,
			ctx: getContext(fixture.booted.payload),
			collection: 'leads',
			status: 'open',
			page: 1,
			limit: 25,
		})
		expect(result.docs.map((row) => row.collection)).toContain('leads')
	})

	it('narrows to one collection when asked', async () => {
		const result = await queue('customers')
		expect(result.docs.map((pair) => pair.collection)).toEqual(['customers'])
		expect(result.counts.open).toBe(1)
	})

	it('scans every collection with a match config when none is named', async () => {
		const result = (await call('/dedupe/scan', { data: {} })) as {
			inline: boolean
			summaries: ScanSummary[]
		}
		expect(result.inline).toBe(true)
		expect(result.summaries.map((summary) => summary.collection)).toEqual(['customers', 'posts'])
	})

	describe('check', () => {
		type Check = { candidates: { id: string; title: string; score: number }[] }
		const check = (body: Record<string, unknown>) =>
			call('/dedupe/check', { data: { collection: 'customers', ...body } }) as Promise<Check>

		it('finds a saved look-alike of unsaved form values without storing anything', async () => {
			const before = await fixture.booted.payload.db.count({ collection: PAIRS_SLUG })
			const result = await check({
				data: { name: 'Queue Person', phone: '+49 151 2345 6789', email: 'other@mail.com' },
			})
			expect(result.candidates.length).toBeGreaterThan(0)
			expect(result.candidates[0]?.title).toBe('Queue Person')
			expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(0.35)
			expect(await fixture.booted.payload.db.count({ collection: PAIRS_SLUG })).toEqual(before)
		})

		it('returns nothing for values that resemble no one', async () => {
			const result = await check({ data: { name: 'Nobody Here', phone: '000' } })
			expect(result.candidates).toEqual([])
		})

		it('leaves the document being edited out of its own candidates', async () => {
			const { docs } = await fixture.booted.payload.find({
				collection: 'customers',
				where: { email: { equals: 'queue@mail.com' } },
			})
			const self = docs[0] as Doc
			const result = await check({
				// As the form sends it: a number on Postgres.
				id: self.id as string,
				data: { name: 'Queue Person', phone: '0151 2345 6789', email: 'queue@mail.com' },
			})
			expect(result.candidates.map((candidate) => candidate.id)).not.toContain(String(self.id))
		})
	})

	it("names the documents of a group in the reader's locale, or the default one", async () => {
		const { payload } = fixture.booted
		const a = await fixture.customer({
			name: 'Title Twin',
			email: 'title-a@mail.com',
			phone: '0151 6666 1111',
		})
		const b = await fixture.customer({
			name: 'Title Twin',
			email: 'title-b@mail.com',
			phone: '0151 6666 1111',
		})
		await payload.update({
			collection: 'customers' as never,
			id: a.id,
			locale: 'de' as never,
			data: { name: 'Titelzwilling' } as never,
		})
		const de = await createLocalReq({ locale: 'de', user: fixture.req.user as never }, payload)
		const result = await readQueue({
			req: de,
			ctx: getContext(payload),
			collection: 'customers',
			status: 'open',
			page: 1,
			limit: 100,
		})
		const row = rowsWith(result, a)[0]
		const title = (doc: Doc) => row?.docs.find((entry) => entry.id === String(doc.id))?.title
		expect(title(a)).toBe('Titelzwilling')
		expect(title(b)).toBe('Title Twin')
	})

	describe('not duplicates', () => {
		const raw = (
			path: string,
			data: Record<string, unknown>,
			{ base = fixture.req, cookie }: { base?: PayloadRequest; cookie?: string } = {}
		) => {
			const endpoint = (fixture.booted.payload.config.endpoints as Endpoint[]).find(
				(entry) => entry.path === path
			) as Endpoint
			const headers = new Headers(cookie ? { cookie } : {})
			return endpoint.handler(
				Object.assign(Object.create(base), { data, headers }) as PayloadRequest
			)
		}
		const lead = (email: string) =>
			fixture.booted.payload.create({ collection: LEADS, data: { email } as never }) as Promise<Doc>
		const statusOf = async (a: Doc, b: Doc) =>
			(await findPairByKey(fixture.req, pairKeyFor('leads', a.id, b.id)))?.status

		it('marks every pair of a group, also those the scorer never found, and reopens them', async () => {
			const group = [
				await lead('group-a@mail.com'),
				await lead('group-b@mail.com'),
				await lead('group-c@mail.com'),
			]
			const [a, b, c] = group as [Doc, Doc, Doc]
			const docs = group.map((doc) => String(doc.id))

			expect((await raw('/dedupe/dismiss', { collection: 'leads', docs })).status).toBe(200)
			expect([await statusOf(a, b), await statusOf(a, c), await statusOf(b, c)]).toEqual([
				'dismissed',
				'dismissed',
				'dismissed',
			])

			expect((await raw('/dedupe/reopen', { collection: 'leads', docs })).status).toBe(200)
			expect([await statusOf(a, b), await statusOf(a, c), await statusOf(b, c)]).toEqual([
				'open',
				'open',
				'open',
			])
		})

		it('says a group is marked not duplicates only once every pair of it is', async () => {
			const group = [
				await lead('partial-a@mail.com'),
				await lead('partial-b@mail.com'),
				await lead('partial-c@mail.com'),
			]
			const [a, , c] = group as [Doc, Doc, Doc]
			const plan = () =>
				buildPlanResponse({
					req: fixture.req,
					ctx: getContext(fixture.booted.payload),
					col: getCollectionContext(fixture.booted.payload, LEADS),
					survivorId: group[0]?.id as string,
					absorbedIds: group.slice(1).map((doc) => doc.id),
					choices: {},
				})
			await raw('/dedupe/dismiss', { collection: 'leads', docs: [String(a.id), String(c.id)] })
			const partly = await plan()
			expect(partly.dismissed).toBeNull()
			expect(partly.markedApart.map((entry) => [...entry.docs].sort())).toEqual([
				[String(a.id), String(c.id)].sort(),
			])

			const [d, e, f] = [
				await lead('chain-d@mail.com'),
				await lead('chain-e@mail.com'),
				await lead('chain-f@mail.com'),
			]
			await raw('/dedupe/dismiss', { collection: 'leads', docs: [String(d.id), String(e.id)] })
			await raw('/dedupe/dismiss', { collection: 'leads', docs: [String(e.id), String(f.id)] })
			const chain = await buildPlanResponse({
				req: fixture.req,
				ctx: getContext(fixture.booted.payload),
				col: getCollectionContext(fixture.booted.payload, LEADS),
				survivorId: d.id,
				absorbedIds: [e.id, f.id],
				choices: {},
			})
			expect(chain.dismissed, 'a chain marked in two goes').not.toBeNull()

			await raw('/dedupe/dismiss', {
				collection: 'leads',
				docs: group.map((doc) => String(doc.id)),
			})
			expect((await plan()).dismissed).not.toBeNull()
		})

		it('lists no group with a document the reader may not read, nor counts it', async () => {
			const vault = (owner: string) =>
				fixture.booted.payload.create({
					collection: VAULTS,
					data: { name: 'Owned vault', owner } as never,
				}) as Promise<Doc>
			const docs = [await vault('owner-hide@example.com'), await vault('owner-hide@example.com')]
			await raw('/dedupe/dismiss', {
				collection: 'vaults',
				docs: docs.map((doc) => String(doc.id)),
			})
			const queue = async (email: string) =>
				readQueue({
					req: await reqFor(fixture.booted, email),
					ctx: getContext(fixture.booted.payload),
					collection: 'vaults',
					status: 'dismissed',
					page: 1,
					limit: 25,
				})
			const own = await queue('owner-hide@example.com')
			expect(own.docs).toHaveLength(1)
			const other = await queue('owner-other@example.com')
			expect(other.docs).toHaveLength(0)
			expect(other.counts.dismissed).toBe(0)
		})

		it('will not decide on documents of another tenant than the one selected', async () => {
			const docs = [
				await fixture.customer({ name: 'North One', email: 'n1@tenant.test', tenant: 'north' }),
				await fixture.customer({ name: 'North Two', email: 'n2@tenant.test', tenant: 'north' }),
			].map((doc) => String(doc.id))
			const as = (tenant: string) => ({ cookie: `payload-tenant=${tenant}` })
			expect(
				(await raw('/dedupe/dismiss', { collection: 'customers', docs }, as('south'))).status
			).toBe(404)
			expect(
				(await raw('/dedupe/dismiss', { collection: 'customers', docs }, as('north'))).status
			).toBe(200)
		})

		it('decides on a collection without a tenant field whichever tenant is selected', async () => {
			const docs = [await lead('shared-a@mail.com'), await lead('shared-b@mail.com')].map((doc) =>
				String(doc.id)
			)
			const response = await raw(
				'/dedupe/dismiss',
				{ collection: 'leads', docs },
				{ cookie: 'payload-tenant=north' }
			)
			expect(response.status).toBe(200)
		})

		it('will not let a reviewer decide on documents they may not read', async () => {
			const docs = [await lead('hidden-a@mail.com'), await lead('hidden-b@mail.com')].map((doc) =>
				String(doc.id)
			)
			const limited = await reqFor(fixture.booted, 'limited-decider@example.com')
			const response = await raw(
				'/dedupe/dismiss',
				{ collection: 'leads', docs },
				{ base: limited }
			)
			expect(response.status).toBe(403)
		})

		it('keeps the decision through the trash and back, and drops it once a document is gone', async () => {
			const { payload } = fixture.booted
			const a = await fixture.customer({
				name: 'Trash Twin',
				email: 'trash-a@mail.com',
				phone: '0151 8888 2222',
			})
			const b = await fixture.customer({
				name: 'Trash Twin',
				email: 'trash-b@mail.com',
				phone: '0151 8888 2222',
			})
			const status = async () =>
				(await findPairByKey(fixture.req, pairKeyFor('customers', a.id, b.id)))?.status
			expect(await status()).toBe('open')
			const docs = [a, b].map((doc) => String(doc.id))
			expect((await raw('/dedupe/dismiss', { collection: 'customers', docs })).status).toBe(200)

			await payload.update({
				collection: 'customers' as never,
				id: a.id,
				data: { deletedAt: new Date().toISOString() } as never,
			})
			expect(await status()).toBe('dismissed')
			const listed = await readQueue({
				req: fixture.req,
				ctx: getContext(payload),
				collection: 'customers',
				status: 'dismissed',
				page: 1,
				limit: 100,
			})
			const row = rowsWith(listed, a)[0]
			expect(row?.docs.find((doc) => doc.id === String(a.id))?.trashed).toBe(true)
			expect(row?.docs.find((doc) => doc.id === String(b.id))?.trashed).toBe(false)
			await payload.update({
				collection: 'customers' as never,
				id: a.id,
				data: { deletedAt: null } as never,
				trash: true,
			})
			expect(await status()).toBe('dismissed')

			await payload.delete({ collection: 'customers' as never, id: a.id })
			expect(await status()).toBe('superseded')
		})

		it('brings a merged-in document restored from the trash back to the queue beside the primary', async () => {
			const { payload } = fixture.booted
			const keep = await fixture.customer({
				name: 'Undo Twin',
				email: 'undo-a@mail.com',
				phone: '0151 7777 3333',
			})
			const gone = await fixture.customer({
				name: 'Undo Twin',
				email: 'undo-b@mail.com',
				phone: '0151 7777 3333',
			})
			await applyMerge({
				req: fixture.req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'customers'),
				survivorId: keep.id,
				absorbedIds: [gone.id],
				choices: {},
			})
			const status = async () =>
				(await findPairByKey(fixture.req, pairKeyFor('customers', keep.id, gone.id)))?.status
			expect(await status()).toBe('merged')
			await payload.update({
				collection: 'customers' as never,
				id: gone.id,
				data: { deletedAt: null } as never,
				trash: true,
			})
			expect(await status()).toBe('open')
		})

		it('keeps a document back from the trash in one row with the rest of its chain', async () => {
			const { payload } = fixture.booted
			const twin = (label: string) =>
				fixture.customer({
					name: 'Chain Twin',
					email: `${label}@chain.test`,
					phone: '0151 9999 1111',
				})
			const [keep, gone, third] = [await twin('keep'), await twin('gone'), await twin('third')]
			await applyMerge({
				req: fixture.req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'customers'),
				survivorId: keep.id,
				absorbedIds: [gone.id],
				choices: {},
			})
			await payload.update({
				collection: 'customers' as never,
				id: gone.id,
				data: { deletedAt: null } as never,
				trash: true,
			})
			const rows = rowsWith(await queue('customers'), keep)
			expect(rows.map((row) => row.docs.map((doc) => doc.id).sort())).toEqual([
				[keep, gone, third].map((doc) => String(doc.id)).sort(),
			])
		})

		it('drops the decision on a collection without a match config once a document is gone', async () => {
			const [a, b] = [await lead('gone-a@mail.com'), await lead('gone-b@mail.com')] as [Doc, Doc]
			const docs = [a, b].map((doc) => String(doc.id))
			expect((await raw('/dedupe/dismiss', { collection: 'leads', docs })).status).toBe(200)
			await fixture.booted.payload.delete({ collection: LEADS, id: a.id })
			expect(await statusOf(a, b)).toBe('superseded')
		})
	})

	it('lists pairs a reviewer may not read by their ids instead of failing', async () => {
		const limited = await reqFor(fixture.booted, 'limited-queue@example.com')
		const result = await readQueue({
			req: limited,
			ctx: getContext(fixture.booted.payload),
			collection: null,
			status: 'open',
			page: 1,
			limit: 25,
		})
		const lead = result.docs.find((row) => row.collection === 'leads')
		expect(lead?.docs[0]?.title).toBe(lead?.docs[0]?.id)
	})

	it('names both documents of a merged pair, the absorbed one from the trash, and links the merge', async () => {
		const { customer, req } = fixture
		const keep = await customer({
			name: 'Merged Queue',
			email: 'mq@mail.com',
			phone: '0170 111 2222',
		})
		const drop = await customer({
			name: 'Merged Queue',
			email: 'mq.2@mail.com',
			phone: '+49 170 111 2222',
		})
		const ctx = getContext(fixture.booted.payload)
		const col = getCollectionContext(fixture.booted.payload, 'customers')
		const { mergeId } = await applyMerge({
			req,
			ctx,
			col,
			survivorId: keep.id,
			absorbedIds: [drop.id],
			choices: {},
		})
		const merged = await readQueue({
			req,
			ctx,
			collection: 'customers',
			status: 'merged',
			page: 1,
			limit: 25,
		})
		const [pair] = rowsWith(merged, drop)
		const absorbed = pair?.docs.find((doc) => doc.id === String(drop.id))
		expect(absorbed?.title).toBe('Merged Queue')
		expect(pair?.merge).toBe(mergeId)
	})

	it('names the document a merge deleted from the copy its record keeps', async () => {
		const { booted, req } = fixture
		const lead = (email: string) =>
			booted.payload.create({ collection: LEADS, data: { email } as never }) as Promise<Doc>
		const [keep, drop] = [await lead('kept@leads.test'), await lead('deleted@leads.test')]
		await pairRow('leads', [keep, drop])
		const ctx = getContext(booted.payload)
		await applyMerge({
			req,
			ctx,
			col: getCollectionContext(booted.payload, 'leads'),
			survivorId: keep.id,
			absorbedIds: [drop.id],
			choices: {},
		})
		const merged = await readQueue({
			req,
			ctx,
			collection: 'leads',
			status: 'merged',
			page: 1,
			limit: 25,
		})
		const [pair] = rowsWith(merged, drop)
		const absorbed = pair?.docs.find((doc) => doc.id === String(drop.id))
		expect(absorbed?.title).toBe('deleted@leads.test')
	})

	it('names a related document in the plan only to a reader who may read it', async () => {
		const { booted, customer } = fixture
		const company = (await booted.payload.create({
			collection: 'companies',
			data: { name: 'Secret GmbH' } as never,
		})) as Doc
		const left = await customer({ name: 'Plan Person', email: 'plan-a@mail.com' })
		const right = await customer({
			name: 'Plan Person',
			email: 'plan-b@mail.com',
			company: company.id,
		})
		const limited = await reqFor(booted, 'limited-planner@example.com')
		const plan = await buildPlanResponse({
			req: limited,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'customers'),
			survivorId: left.id,
			absorbedIds: [right.id],
			choices: {},
		})
		const decision = plan.decisions.find((entry) => entry.path === 'company')
		expect(JSON.stringify(decision?.relationLabels ?? {})).not.toContain('Secret GmbH')
	})
	describe('groups', () => {
		const lead = (email: string) =>
			fixture.booted.payload.create({ collection: LEADS, data: { email } as never }) as Promise<Doc>
		const ids = (docs: Doc[]) => docs.map((doc) => String(doc.id)).sort()

		it('shows documents linked by pairs in a chain as one row, the most alike first', async () => {
			const [a, b, c] = [
				await lead('chain-a@group.test'),
				await lead('chain-b@group.test'),
				await lead('chain-c@group.test'),
			]
			await pairRow('leads', [a, b], 0.9)
			await pairRow('leads', [b, c], 0.6)
			const result = await queue('leads')
			const rows = rowsWith(result, c)
			expect(rows).toHaveLength(1)
			const docs = rows[0]?.docs.map((doc) => doc.id) ?? []
			expect(docs.slice(0, 2).sort()).toEqual(ids([a, b]))
			expect(docs[2]).toBe(String(c.id))
			expect(rows[0]?.score).toBe(0.9)
			expect(result.counts.open).toBe(result.totalDocs)
		})

		it('shows the documents of one merge as one row under merged', async () => {
			const [keep, x, y] = [
				await lead('merge-a@group.test'),
				await lead('merge-b@group.test'),
				await lead('merge-c@group.test'),
			]
			await pairRow('leads', [keep, x])
			await pairRow('leads', [keep, y])
			await pairRow('leads', [x, y])
			const ctx = getContext(fixture.booted.payload)
			const { mergeId } = await applyMerge({
				req: fixture.req,
				ctx,
				col: getCollectionContext(fixture.booted.payload, 'leads'),
				survivorId: keep.id,
				absorbedIds: [x.id, y.id],
				choices: {},
			})
			const merged = await readQueue({
				req: fixture.req,
				ctx,
				collection: 'leads',
				status: 'merged',
				page: 1,
				limit: 25,
			})
			const rows = rowsWith(merged, keep)
			expect(rows).toHaveLength(1)
			expect(rows[0]?.merge).toBe(mergeId)
			expect(rows[0]?.docs.map((doc) => doc.id).sort()).toEqual(ids([keep, x, y]))
		})

		it('keeps a group whole past one page of pairs', async () => {
			const { payload } = fixture.booted
			const chain: Doc[] = []
			for (let index = 0; index <= 250; index++) {
				chain.push(
					(await payload.db.create({
						collection: LEADS,
						data: { email: `long-${index}@group.test` },
					})) as Doc
				)
			}
			for (let index = 1; index < chain.length; index++) {
				await pairRow('leads', [chain[index - 1] as Doc, chain[index] as Doc], 0.99)
			}
			const result = await queue('leads')
			const rows = rowsWith(result, chain[0] as Doc)
			expect(rows).toHaveLength(1)
			expect(rows[0]?.docs.map((doc) => doc.id).sort()).toEqual(ids(chain))
			expect(rowsWith(result, chain[250] as Doc)).toEqual(rows)

			const chained = chain.map((doc) => String(doc.id))
			await payload.db.deleteMany({
				collection: PAIRS_SLUG,
				where: { and: [{ target: { equals: 'leads' } }, { docA: { in: chained } }] },
			})
			await payload.db.deleteMany({ collection: LEADS, where: { id: { in: chained } } })
		})
	})
})
