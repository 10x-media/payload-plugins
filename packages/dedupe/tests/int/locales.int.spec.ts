import { describeForDb, skipForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import { BRIEFS, bootDedupe, type Doc, MANUALS, pluginOptions } from './fixtures'

type Locales = Record<string, string>

/**
 * The language a merge writes the values every language shares in, and the languages a
 * primary already lacked a required value in before the merge.
 */
describeForDb('dedupe write locale', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	const args = (
		collection: CollectionSlug,
		[keep, gone]: [Doc, Doc],
		choices: Record<string, MergeChoice> = {}
	) => ({
		req: fixture.req,
		ctx: getContext(fixture.booted.payload),
		col: getCollectionContext(fixture.booted.payload, collection),
		survivorId: keep.id,
		absorbedIds: [gone.id],
		choices,
	})
	const stored = (collection: CollectionSlug, id: number | string) =>
		fixture.booted.payload.findByID({
			collection,
			id,
			depth: 0,
			locale: 'all' as never,
		}) as Promise<Doc>

	/** A manual written in German only, as a tenant whose language is not the default one has it. */
	const germanManual = async (mark: string, sealed: boolean) =>
		(await fixture.booted.payload.create({
			collection: MANUALS,
			locale: 'de' as never,
			data: { title: `${mark} de`, code: mark, motto: `${mark} motto`, sealed } as never,
		})) as Doc

	it('writes the values every language shares in a language the primary is complete in', async () => {
		n++
		const keep = await germanManual(`keep${n}`, false)
		const gone = await germanManual(`gone${n}`, true)
		const merge = args(MANUALS, [keep, gone], { sealed: { doc: String(gone.id) } })
		const plan = await buildPlanResponse(merge)
		expect(plan.blocked).toBeNull()
		expect(plan.readyToApply).toBe(true)
		await applyMerge(merge)
		const merged = await stored(MANUALS, keep.id)
		expect(merged.sealed).toBe(true)
		expect((merged.title as Locales).de).toBe(`keep${n} de`)
		expect((merged.title as Locales).en ?? null).toBeNull()
	})

	/** Published in English, then a German draft published with English, unchecked: Roma's case. */
	const brief = async (title: string, german?: Locales) => {
		const { payload } = fixture.booted
		const doc = (await payload.create({
			collection: BRIEFS,
			data: { title, _status: 'published' } as never,
		})) as Doc
		if (german) {
			await payload.update({
				collection: BRIEFS,
				id: doc.id,
				locale: 'de' as never,
				draft: true,
				data: german as never,
			})
			await payload.update({
				collection: BRIEFS,
				id: doc.id,
				data: { _status: 'published' } as never,
			})
		}
		return doc
	}

	it('publishes a language the primary lacked a required value in before, as Payload publishes a draft of it', async () => {
		n++
		const keep = await brief(`Keep ${n}`)
		const gone = await brief(`Gone ${n}`, { subtitle: `sub ${n}` })
		const merge = args(BRIEFS, [keep, gone])
		const plan = await buildPlanResponse(merge)
		expect(plan.blocked).toBeNull()
		expect(plan.readyToApply).toBe(true)
		await applyMerge(merge)
		const merged = await stored(BRIEFS, keep.id)
		expect(merged._status).toBe('published')
		expect((merged.subtitle as Locales).de).toBe(`sub ${n}`)
		expect((merged.title as Locales).en).toBe(`Keep ${n}`)
		const latest = (await fixture.booted.payload.findByID({
			collection: BRIEFS,
			id: keep.id,
			draft: true,
			depth: 0,
		})) as Doc
		expect(latest._status, 'no draft left on top of the merge').toBe('published')
	})

	// SQL keeps a required localized value of a collection without drafts NOT NULL: no such
	// language can be stored there at all.
	skipForDb(
		'postgres',
		db,
		'still refuses a language without drafts that the primary lacked a required value in',
		async () => {
			n++
			const { payload } = fixture.booted
			// Payload saves no such language: written past it, through the database layer.
			const manual = async (mark: string, subtitle?: string) => {
				const created = (await payload.create({
					collection: MANUALS,
					data: { title: mark, code: mark, motto: mark } as never,
				})) as Doc
				if (subtitle) {
					await payload.db.updateOne({
						collection: MANUALS,
						id: created.id,
						data: { subtitle: { de: subtitle } },
					})
				}
				return created
			}
			const keep = await manual(`keep${n}`)
			const gone = await manual(`gone${n}`, `sub ${n}`)
			const plan = await buildPlanResponse(args(MANUALS, [keep, gone]))
			expect(plan.readyToApply).toBe(false)
			expect(plan.blocked).toMatch(/"Title" in de/)
		}
	)

	it('writes in the language writeLocale answers', async () => {
		const answered = await bootDedupe(db, {
			collections: { ...pluginOptions.collections, briefs: { writeLocale: () => 'de' } },
		})
		try {
			const both = async (mark: string, price: number) => {
				const doc = (await answered.booted.payload.create({
					collection: BRIEFS,
					data: { title: `${mark} en`, price, _status: 'published' } as never,
				})) as Doc
				await answered.booted.payload.update({
					collection: BRIEFS,
					id: doc.id,
					locale: 'de' as never,
					data: { title: `${mark} de`, _status: 'published' } as never,
				})
				return doc
			}
			const keep = await both('Keep', 1)
			const gone = await both('Gone', 2)
			const update = vi.spyOn(answered.booted.payload, 'update')
			await applyMerge({
				req: answered.req,
				ctx: getContext(answered.booted.payload),
				col: getCollectionContext(answered.booted.payload, BRIEFS),
				survivorId: keep.id,
				absorbedIds: [gone.id],
				choices: { price: { doc: String(gone.id) } },
			})
			const first = update.mock.calls
				.map(([call]) => call as { id?: unknown; locale?: string })
				.find((call) => String(call.id) === String(keep.id))
			expect(first?.locale).toBe('de')
			update.mockRestore()
		} finally {
			await answered.booted.stop()
		}
	})
})
