import { describeForDb, expectForDb, skipForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import {
	ACCOUNTS,
	bootDedupe,
	COMPANIES,
	type Doc,
	HIDX,
	KITS,
	POSTS,
	TEAMS,
	TICKETS,
} from './fixtures'

/** The fields whose value the survivor takes from the absorbed document. */
const take = (...keys: string[]): string[] => keys

/** The survivor takes unique values over from the absorbed document, merge after merge. */
describeForDb('dedupe unique values', {}, (db) => {
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

	/** An account with every unique value its own, localized ones in English and German. */
	const account = async () => {
		n += 1
		const doc = await create(ACCOUNTS, {
			name: `Account ${n}`,
			email: `a${n}@unique.test`,
			handle: `handle-${n}`,
			slug: `slug-${n}`,
			code: `c${n}`,
			seat: n,
			pin: 1000 + n,
			badge: (await create(COMPANIES, { name: `Badge ${n}` })).id,
			region: 'eu',
			externalId: `ext-${n}`,
			desk: n,
			title: `title-${n}`,
			subtitle: `subtitle-${n}`,
			label: `label-${n}`,
		})
		await fixture.booted.payload.update({
			collection: ACCOUNTS,
			id: doc.id,
			data: {
				slug: `slug-de-${n}`,
				title: `title-de-${n}`,
				subtitle: `subtitle-de-${n}`,
				label: `label-de-${n}`,
			} as never,
			locale: 'de',
		})
		return doc
	}

	const args = (collection: CollectionSlug, [survivor, absorbed]: [Doc, Doc], taken: string[]) => ({
		req: fixture.req,
		ctx: getContext(fixture.booted.payload),
		col: getCollectionContext(fixture.booted.payload, collection),
		survivorId: survivor.id,
		absorbedIds: [absorbed.id],
		choices: Object.fromEntries(taken.map((key) => [key, { doc: String(absorbed.id) }])),
	})

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('leaves the absorbed document in the trash with a placeholder where a string moved', async () => {
		const taken = take('email', 'handle', 'slug@en', 'externalId')
		for (const _round of [1, 2]) {
			const survivor = await account()
			const absorbed = await account()
			const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], taken))
			expect(plan.release[String(absorbed.id)]).toEqual({
				marked: ['email', 'handle', 'slug@en', 'externalId'],
				emptied: [],
				deletes: [],
			})

			await applyMerge(args(ACCOUNTS, [survivor, absorbed], taken))
			const kept = (await find(ACCOUNTS, survivor.id)) as Doc
			const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
			const marker = `merged-${absorbed.id}`
			expect(gone.deletedAt).toBeTruthy()
			// The value it held stays readable beside the mark; an email gets a domain no mail reaches.
			expect(gone.email).toBe(`${marker}.a${n}@unique.test.invalid`)
			expect(gone.handle).toBe(`${marker} handle-${n}`)
			expect(gone.slug).toEqual({ en: `${marker} slug-${n}`, de: `slug-de-${n}` })
			expect(gone.externalId).toBe(`${marker} ext-${n}`)
			expect(gone.title).toEqual({ en: `title-${n}`, de: `title-de-${n}` })
			expect(kept.email).toBe(`a${n}@unique.test`)
			expect(kept.handle).toBe(`handle-${n}`)
			expect(kept.slug).toEqual({ en: `slug-${n}`, de: `slug-de-${n - 1}` })
			expect(kept.externalId).toBe(`ext-${n}`)
		}
	})

	it('keeps the rest of a group around the unique value it marks', async () => {
		const survivor = await account()
		const absorbed = await account()
		for (const [doc, mark] of [
			[survivor, 's'],
			[absorbed, 'g'],
		] as const) {
			await fixture.booted.payload.update({
				collection: ACCOUNTS,
				id: doc.id,
				data: { contact: { email: `${mark}${n}@contact.test`, phone: `phone-${mark}` } } as never,
			})
		}
		await applyMerge(args(ACCOUNTS, [survivor, absorbed], take('contact.email')))
		const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
		expect(gone.contact).toMatchObject({
			email: `merged-${absorbed.id}.g${n}@contact.test.invalid`,
			phone: 'phone-g',
		})
	})

	it('keeps the rest of the absorbed document around two unique values of one group, one localized', async () => {
		const kit = (mark: string) =>
			create(KITS, {
				name: 'Group kit',
				title: `title-${mark}`,
				ref: `ref-${mark}`,
				contact: { email: `${mark}@kit.test`, slug: `${mark}-slug`, phone: `phone-${mark}` },
			})
		const survivor = await kit('ks')
		const absorbed = await kit('kg')
		await applyMerge(args(KITS, [survivor, absorbed], take('contact.email', 'contact.slug@en')))
		const gone = (await find(KITS, absorbed.id)) as Doc
		const marker = `merged-${absorbed.id}`
		expect(gone.title).toBe('title-kg')
		expect(gone.contact).toEqual({
			email: `${marker}.kg@kit.test.invalid`,
			slug: { en: `${marker} kg-slug` },
			phone: 'phone-kg',
		})
	})

	it('frees a value for a unique index over a field hidden from the API as its plan says', async () => {
		const survivor = await create(KITS, {
			name: 'Hidden index',
			title: 'k1',
			region: 'eu',
			ref: 'R-1',
		})
		const absorbed = await create(KITS, {
			name: 'Hidden index',
			title: 'k2',
			region: 'us',
			ref: 'R-1',
		})
		const plan = await buildPlanResponse(args(KITS, [survivor, absorbed], take('region')))
		expect(plan.release[String(absorbed.id)]?.marked).toEqual(['ref'])
		await applyMerge(args(KITS, [survivor, absorbed], take('region')))
		expect(((await find(KITS, survivor.id)) as Doc).region).toBe('us')
	})

	it('frees nothing for a unique index over a field hidden from the API that holds different values', async () => {
		const survivor = await create(KITS, {
			name: 'Other ref',
			title: 'o1',
			region: 'eu',
			ref: 'O-1',
		})
		const absorbed = await create(KITS, {
			name: 'Other ref',
			title: 'o2',
			region: 'us',
			ref: 'O-2',
		})
		const plan = await buildPlanResponse(args(KITS, [survivor, absorbed], take('region')))
		expect(plan.release[String(absorbed.id)]).toEqual({ marked: [], emptied: [], deletes: [] })
		await applyMerge(args(KITS, [survivor, absorbed], take('region')))
		expect(((await find(KITS, absorbed.id)) as Doc).deletedAt).toBeTruthy()
	})

	it('keeps the draft of the absorbed document in the other languages of a value it marks', async () => {
		const post = async (mark: string) => {
			const doc = await create(POSTS, {
				title: 'Draft slug',
				code: `ds-${mark}`,
				slug: `${mark}-en`,
				_status: 'published',
			})
			await fixture.booted.payload.update({
				collection: POSTS,
				id: doc.id,
				locale: 'de',
				data: { slug: `${mark}-de`, _status: 'published' } as never,
			})
			return doc
		}
		const survivor = await post('ds1')
		const absorbed = await post('ds2')
		await fixture.booted.payload.update({
			collection: POSTS,
			id: absorbed.id,
			locale: 'de',
			draft: true,
			data: { slug: 'ds2-de-draft' } as never,
		})
		await applyMerge(args(POSTS, [survivor, absorbed], take('slug@en')))
		const latest = (await fixture.booted.payload.findByID({
			collection: POSTS,
			id: absorbed.id,
			draft: true,
			locale: 'all',
			trash: true,
			depth: 0,
		})) as Doc
		expect(latest.slug).toEqual({ en: `merged-${absorbed.id} ds2-en`, de: 'ds2-de-draft' })
	})

	skipForDb(
		'postgres',
		db,
		'keeps the items of a unique list the survivor does not take, beside the placeholder',
		async () => {
			const survivor = await account()
			const absorbed = await account()
			for (const [doc, aliases] of [
				[survivor, ['s-alias']],
				[absorbed, ['y-alias', 'z-alias']],
			] as const) {
				await fixture.booted.payload.update({
					collection: ACCOUNTS,
					id: doc.id,
					data: { aliases } as never,
				})
			}
			await applyMerge({
				...args(ACCOUNTS, [survivor, absorbed], []),
				choices: { aliases: { items: [{ doc: String(absorbed.id), index: 0 }] } },
			})
			const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
			expect(gone.aliases).toEqual(['z-alias', `merged-${absorbed.id}`])
		}
	)

	it('frees nothing for a unique index over a field of a group hidden from the API that holds different values', async () => {
		const survivor = await create(HIDX, {
			name: 'Hidden group',
			region: 'eu',
			vendor: { code: 'A' },
		})
		const absorbed = await create(HIDX, {
			name: 'Hidden group',
			region: 'us',
			vendor: { code: 'B' },
		})
		const plan = await buildPlanResponse(args(HIDX, [survivor, absorbed], take('region')))
		expect(plan.release[String(absorbed.id)]).toEqual({ marked: [], emptied: [], deletes: [] })
	})

	it('reads an empty member of a unique index the way each database compares it', async () => {
		const survivor = await create(HIDX, { name: 'No vendor', region: 'eu' })
		const absorbed = await create(HIDX, { name: 'No vendor', region: 'us' })
		const plan = await buildPlanResponse(args(HIDX, [survivor, absorbed], take('region')))
		// Postgres lets a row with a null member repeat; MongoDB indexes the missing value as null.
		expect(plan.release[String(absorbed.id)]).toEqual(
			expectForDb(db, {
				mongo: { marked: ['vendor.code'], emptied: [], deletes: [] },
				postgres: { marked: [], emptied: [], deletes: [] },
			})
		)
	})

	it('counts an empty string in a unique index as the value it is', async () => {
		const survivor = await account()
		const absorbed = await account()
		for (const [doc, region] of [
			[survivor, 'eu'],
			[absorbed, 'us'],
		] as const) {
			await fixture.booted.payload.update({
				collection: ACCOUNTS,
				id: doc.id,
				data: { region, externalId: '' } as never,
			})
		}
		const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], take('region')))
		expect(plan.release[String(absorbed.id)]?.marked).toContain('externalId')
	})

	it('reads a unique index over localized fields the way each database builds it', async () => {
		// MongoDB indexes every locale of the fields together; Postgres indexes each locale apart.
		const english = take('title@en', 'subtitle@en')
		const all = take('title@en', 'title@de', 'subtitle@en', 'subtitle@de')
		for (const [taken, marked] of [
			[english, expectForDb(db, { mongo: [], postgres: ['title@en'] })],
			[all, expectForDb(db, { mongo: ['title@en'], postgres: ['title@en', 'title@de'] })],
		] as const) {
			const survivor = await account()
			const absorbed = await account()
			const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], taken))
			expect(plan.release[String(absorbed.id)]).toEqual({ marked, emptied: [], deletes: [] })

			await applyMerge(args(ACCOUNTS, [survivor, absorbed], taken))
			const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
			const title = { en: `title-${n}`, de: `title-de-${n}` }
			for (const key of marked) {
				const locale = key.split('@')[1] as 'de' | 'en'
				title[locale] = `merged-${absorbed.id} ${title[locale]}`
			}
			expect(gone.title).toEqual(title)
			expect(gone.deletedAt).toBeTruthy()
		}
	})

	skipForDb(
		'postgres',
		db,
		'releases a unique index over a plain and a localized field',
		async () => {
			const taken = take('label@en', 'label@de')
			const survivor = await account()
			const absorbed = await account()
			const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], taken))
			expect(plan.release[String(absorbed.id)]).toEqual({
				marked: ['label@en'],
				emptied: [],
				deletes: [],
			})

			await applyMerge(args(ACCOUNTS, [survivor, absorbed], taken))
			const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
			expect(gone.label).toEqual({ en: `merged-${absorbed.id} label-${n}`, de: `label-de-${n}` })
		}
	)

	it('marks a unique value inside rows the survivor takes, as a value at the top', async () => {
		for (const [key, rows, held] of [
			[
				'phones',
				(tag: string) => ({ phones: [{ number: `+49 ${tag}` }] }),
				(gone: Doc) => (gone.phones as { number: string }[])[0]?.number,
			],
			[
				'links',
				(tag: string) => ({ links: [{ blockType: 'site', href: `https://${tag}.test` }] }),
				(gone: Doc) => (gone.links as { href: string }[])[0]?.href,
			],
		] as const) {
			const survivor = await account()
			const absorbed = await account()
			for (const doc of [survivor, absorbed]) {
				await fixture.booted.payload.update({
					collection: ACCOUNTS,
					id: doc.id,
					data: rows(String(doc.id)) as never,
				})
			}
			const both = {
				...args(ACCOUNTS, [survivor, absorbed], []),
				choices: {
					[key]: {
						items: [
							{ doc: String(survivor.id), index: 0 },
							{ doc: String(absorbed.id), index: 0 },
						],
					},
				},
			}
			const plan = await buildPlanResponse(both)
			expect(plan.release[String(absorbed.id)]).toEqual({ marked: [key], emptied: [], deletes: [] })

			await applyMerge(both)
			const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
			expect(gone.deletedAt).toBeTruthy()
			const value = key === 'phones' ? `+49 ${absorbed.id}` : `https://${absorbed.id}.test`
			expect(held(gone), `${key} keeps its row`).toBe(`merged-${absorbed.id} ${value}`)
			const kept = (await find(ACCOUNTS, survivor.id)) as Doc
			expect(kept[key]).toHaveLength(2)
		}
	})

	it('marks a unique value in the rows of a localized group, in that locale only', async () => {
		const team = async (badge: string) => {
			const doc = await create(TEAMS, {
				name: `Team ${badge}`,
				card: { title: `card ${badge}`, lines: [{ text: 'line', badge }] },
			})
			await fixture.booted.payload.update({
				collection: TEAMS,
				id: doc.id,
				locale: 'de' as never,
				data: {
					card: { title: `karte ${badge}`, lines: [{ text: 'zeile', badge: `de-${badge}` }] },
				} as never,
			})
			return doc
		}
		n += 1
		const survivor = await team(`keep-${n}`)
		const absorbed = await team(`gone-${n}`)
		const merge = args(TEAMS, [survivor, absorbed], take('card@en'))
		const plan = await buildPlanResponse(merge)
		expect(plan.release[String(absorbed.id)]).toEqual({
			marked: ['card@en'],
			emptied: [],
			deletes: [],
		})
		await applyMerge(merge)
		const gone = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: absorbed.id,
			depth: 0,
			trash: true,
			locale: 'en' as never,
		})) as Doc
		const card = gone.card as { title: string; lines: { badge: string }[] }
		expect(card.title).toBe(`card gone-${n}`)
		expect(card.lines[0]?.badge).toBe(`merged-${absorbed.id} gone-${n}`)
		const german = (await fixture.booted.payload.findByID({
			collection: TEAMS,
			id: absorbed.id,
			depth: 0,
			trash: true,
			locale: 'de' as never,
		})) as Doc
		expect((german.card as { lines: { badge: string }[] }).lines[0]?.badge).toBe(`de-gone-${n}`)
	})

	it('empties on Postgres, and deletes on MongoDB, a unique value no placeholder fits', async () => {
		const taken = take('code', 'seat', 'badge', 'desk')
		for (const _round of [1, 2]) {
			const survivor = await account()
			const absorbed = await account()
			const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], taken))
			const keys = ['code', 'seat', 'badge', 'desk']
			expect(plan.release[String(absorbed.id)]).toEqual(
				expectForDb(db, {
					mongo: { marked: [], emptied: [], deletes: keys },
					postgres: { marked: [], emptied: keys, deletes: [] },
				})
			)

			await applyMerge(args(ACCOUNTS, [survivor, absorbed], taken))
			const kept = (await find(ACCOUNTS, survivor.id)) as Doc
			expect([kept.code, kept.seat, kept.desk]).toEqual([`c${n}`, n, n])
			const gone = await find(ACCOUNTS, absorbed.id)
			if (db === 'mongo') {
				expect(gone).toBeNull()
			} else {
				expect(gone?.deletedAt).toBeTruthy()
				expect([gone?.code, gone?.seat, gone?.badge, gone?.desk]).toEqual([null, null, null, null])
			}
		}
	})

	it('deletes the absorbed document on both databases for a required value no placeholder fits', async () => {
		for (const _round of [1, 2]) {
			const survivor = await account()
			const absorbed = await account()
			const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], take('pin')))
			expect(plan.release[String(absorbed.id)]).toEqual({
				marked: [],
				emptied: [],
				deletes: ['pin'],
			})

			await applyMerge(args(ACCOUNTS, [survivor, absorbed], take('pin')))
			expect(((await find(ACCOUNTS, survivor.id)) as Doc).pin).toBe(1000 + n)
			expect(await find(ACCOUNTS, absorbed.id)).toBeNull()
		}
	})

	it('releases nothing when the survivor keeps its own values', async () => {
		const survivor = await account()
		const absorbed = await account()
		const plan = await buildPlanResponse(args(ACCOUNTS, [survivor, absorbed], []))
		expect(plan.release[String(absorbed.id)]).toEqual({ marked: [], emptied: [], deletes: [] })

		await applyMerge(args(ACCOUNTS, [survivor, absorbed], []))
		const gone = (await find(ACCOUNTS, absorbed.id)) as Doc
		expect([gone.email, gone.handle, gone.seat]).toEqual([`a${n}@unique.test`, `handle-${n}`, n])
	})

	it('deletes before the survivor takes the value, where the collection deletes anyway', async () => {
		// Payload writes an explicit empty value when a field is cleared; on MongoDB a second
		// one, even for a moment, is a duplicate.
		await create(TICKETS, { title: 'Cleared', seat: null })
		for (const round of [1, 2]) {
			const survivor = await create(TICKETS, { title: `Keep ${round}`, seat: 100 + round * 2 })
			const absorbed = await create(TICKETS, { title: `Drop ${round}`, seat: 101 + round * 2 })
			await applyMerge(args(TICKETS, [survivor, absorbed], take('seat')))
			expect(((await find(TICKETS, survivor.id)) as Doc).seat).toBe(101 + round * 2)
			expect(await find(TICKETS, absorbed.id)).toBeNull()
		}
	})
	it('lets go of a unique value in a collection with drafts, whose saves start from the newest version', async () => {
		const { payload } = fixture.booted
		const keep = await create(POSTS, { title: 'Drafted keeper', _status: 'published' })
		const drop = await create(POSTS, {
			title: 'Drafted keeper',
			code: 'DR-1',
			_status: 'published',
		})
		await applyMerge({
			req: fixture.req,
			ctx: getContext(payload),
			col: getCollectionContext(payload, 'posts'),
			survivorId: keep.id,
			absorbedIds: [drop.id],
			choices: {},
		})
		expect((await find(POSTS, keep.id))?.code).toBe('DR-1')
		const gone = await find(POSTS, drop.id)
		expect([Boolean(gone?.deletedAt), gone?.code === 'DR-1']).toEqual([true, false])
	})
})
