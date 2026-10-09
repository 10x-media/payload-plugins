import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { PAIRS_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import { ACCOUNTS, bootDedupe, CUSTOMERS, type Doc, emitted } from './fixtures'

/** A group of more than two documents merged at once. */
describeForDb('dedupe group merge', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	const create = (collection: CollectionSlug, data: Record<string, unknown>) =>
		fixture.booted.payload.create({ collection, data: data as never, depth: 0 }) as Promise<Doc>
	const find = (collection: CollectionSlug, id: number | string) =>
		fixture.booted.payload.findByID({
			collection,
			id,
			depth: 0,
			locale: 'all',
			trash: true,
			disableErrors: true,
			overrideAccess: true,
		}) as Promise<Doc | null>
	const args = (
		collection: CollectionSlug,
		[survivor, ...absorbed]: Doc[],
		choices: Record<string, MergeChoice> = {}
	) => ({
		req: fixture.req,
		ctx: getContext(fixture.booted.payload),
		col: getCollectionContext(fixture.booted.payload, collection),
		survivorId: survivor?.id as number | string,
		absorbedIds: absorbed.map((doc) => doc.id),
		choices,
	})
	/** Three entries of one person, each edited after the one before. */
	const trio = async (extra: Record<string, unknown>[] = [{}, {}, {}]) => {
		n += 1
		const docs: Doc[] = []
		for (const [index, data] of extra.entries()) {
			docs.push(
				await fixture.customer({
					name: `Group ${n}`,
					email: `g${n}-${index}@group.test`,
					birthDate: '1990-01-01',
					...data,
				})
			)
		}
		return docs
	}

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('merges three documents into one: values from any of them, both others trashed, one record', async () => {
		const [survivor, middle, newest] = await trio([
			{ phone: '' },
			{ phone: '222', note: 'from the middle' },
			{ phone: '333', note: 'from the newest' },
		])
		const group = [survivor, middle, newest] as Doc[]
		const choices: Record<string, MergeChoice> = { note: { doc: String(middle?.id) } }

		const plan = await buildPlanResponse(args(CUSTOMERS, group, choices))
		expect(plan.docs.map((doc) => doc.id)).toEqual(group.map((doc) => String(doc.id)))
		expect(plan.decisions.find((d) => d.key === 'phone')).toMatchObject({
			proposed: '333',
			source: String(newest?.id),
			auto: true,
			conflict: true,
		})

		await applyMerge(args(CUSTOMERS, group, choices))
		const kept = (await find(CUSTOMERS, survivor?.id as string)) as Doc
		expect([kept.phone, kept.note]).toEqual(['333', 'from the middle'])
		for (const doc of [middle, newest]) {
			expect((await find(CUSTOMERS, doc?.id as string))?.deletedAt).toBeTruthy()
		}

		expect(emitted.at(-1)).toMatchObject({
			type: 'merge.applied',
			survivorId: String(survivor?.id),
			absorbedIds: [String(middle?.id), String(newest?.id)],
		})
	})

	it('builds a list from the values the reviewer checked only', async () => {
		const group = await trio([{ tags: ['a'] }, { tags: ['b', 'a'] }, { tags: ['c'] }])
		const [survivor, middle, newest] = group as [Doc, Doc, Doc]
		await applyMerge(
			args(CUSTOMERS, group, {
				tags: {
					items: [
						{ doc: String(newest.id), index: 0 },
						{ doc: String(middle.id), index: 1 },
						{ doc: String(survivor.id), index: 0 },
					],
				},
			})
		)
		expect(((await find(CUSTOMERS, survivor.id as string)) as Doc).tags).toEqual(['a', 'c'])
	})

	it('frees the unique values the survivor takes from each absorbed document', async () => {
		n += 1
		const account = (tag: string, data: Record<string, unknown> = {}) =>
			create(ACCOUNTS, {
				name: `Group account ${n}${tag}`,
				email: `acc${n}${tag}@group.test`,
				handle: `handle-${n}${tag}`,
				pin: 5000 + n * 10 + tag.charCodeAt(0),
				region: 'eu',
				externalId: `ext-${n}${tag}`,
				desk: n * 10 + tag.charCodeAt(0),
				title: `title-${n}${tag}`,
				subtitle: `subtitle-${n}${tag}`,
				label: `label-${n}${tag}`,
				...data,
			})
		const group = [await account('a'), await account('b'), await account('c')]
		const [, middle, newest] = group as [Doc, Doc, Doc]
		const choices: Record<string, MergeChoice> = {
			email: { doc: String(middle.id) },
			handle: { doc: String(newest.id) },
		}
		const plan = await buildPlanResponse(args(ACCOUNTS, group, choices))
		expect(plan.release).toEqual({
			[String(middle.id)]: { marked: ['email'], emptied: [], deletes: [] },
			[String(newest.id)]: { marked: ['handle'], emptied: [], deletes: [] },
		})

		await applyMerge(args(ACCOUNTS, group, choices))
		expect((await find(ACCOUNTS, middle.id))?.email).toBe(
			`merged-${middle.id}.${String(middle.email)}.invalid`
		)
		expect((await find(ACCOUNTS, newest.id))?.handle).toBe(
			`merged-${newest.id} ${String(newest.handle)}`
		)
	})

	it('deletes every pair of a merged-in document, inside the group and out', async () => {
		const group = await trio([{ phone: '555 1234' }, { phone: '555 1234' }, { phone: '555 1234' }])
		const outsider = await fixture.customer({
			name: `Group ${n}`,
			email: `g${n}-x@group.test`,
			birthDate: '1990-01-01',
			phone: '555 1234',
		})
		const ids = [...group, outsider].map((doc) => String(doc.id))
		const pairs = async () =>
			(
				await fixture.booted.payload.db.find({
					collection: PAIRS_SLUG,
					where: { and: [{ docA: { in: ids } }, { docB: { in: ids } }] },
					pagination: false,
				})
			).docs as unknown as { docA: string; docB: string; status: string }[]
		expect((await pairs()).length).toBe(6)

		await applyMerge(args(CUSTOMERS, group))
		const inGroup = (pair: { docA: string; docB: string }) =>
			[pair.docA, pair.docB].every((id) => group.some((doc) => String(doc.id) === id))
		const after = await pairs()
		expect(after.filter(inGroup)).toEqual([])
		const absorbed = group.slice(1).map((doc) => String(doc.id))
		expect(
			after.filter((pair) => absorbed.includes(pair.docA) || absorbed.includes(pair.docB))
		).toEqual([])
	})

	it('refuses a group over the limit, a document twice, or the survivor among the absorbed', async () => {
		const [survivor, middle] = (await trio()) as [Doc, Doc, Doc]
		const extra = [] as Doc[]
		for (let i = 0; i < 5; i++) {
			extra.push(
				await fixture.customer({ name: `Big ${n} ${i}`, email: `big${n}-${i}@group.test` })
			)
		}
		await expect(applyMerge(args(CUSTOMERS, [survivor, ...extra]))).rejects.toMatchObject({
			status: 400,
		})
		await expect(applyMerge(args(CUSTOMERS, [survivor, middle, middle]))).rejects.toMatchObject({
			status: 400,
		})
		await expect(applyMerge(args(CUSTOMERS, [survivor, survivor]))).rejects.toMatchObject({
			status: 400,
		})
	})
})
