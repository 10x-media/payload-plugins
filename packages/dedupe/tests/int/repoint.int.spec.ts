import { describeForDb, skipForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MERGES_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import { pairKeyFor } from '../../src/match/keys'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { bootDedupe, COMPANIES, type Doc, pluginOptions } from './fixtures'

const ORDERS = 'orders' as CollectionSlug
const MEMBERSHIPS = 'memberships' as CollectionSlug
const TRIPS = 'trips' as CollectionSlug
const NOTES = 'notes' as CollectionSlug

/** References to a merged document move to the survivor. */
describeForDb('dedupe repoint', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	const create = (collection: CollectionSlug, data: Record<string, unknown>, draft = false) =>
		fixture.booted.payload.create({
			collection,
			data: data as never,
			draft,
			depth: 0,
		}) as Promise<Doc>
	const read = (collection: CollectionSlug, id: number | string) =>
		fixture.booted.payload.findByID({ collection, id, depth: 0, draft: true }) as Promise<Doc>
	const idOf = (value: unknown) =>
		String(typeof value === 'object' && value !== null ? (value as { id: unknown }).id : value)
	const plan = (survivor: Doc, absorbed: Doc) =>
		buildPlanResponse({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, 'customers'),
			survivorId: survivor.id,
			absorbedIds: [absorbed.id],
			choices: {},
		})
	const merge = (survivor: Doc, absorbed: Doc) =>
		applyMerge({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, 'customers'),
			survivorId: survivor.id,
			absorbedIds: [absorbed.id],
			choices: {},
		})

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('maps every field that points at the collection, in every shape', () => {
		const col = getCollectionContext(fixture.booted.payload, 'customers')
		const found = col.references.map((ref) => `${ref.collection}.${ref.path}`).sort()
		expect(found).toEqual(
			[
				'customers.referredBy',
				'layouts.layout.inner.guest',
				'layouts.layout.items.person',
				'layouts.layout.lines.member',
				'layouts.layout.members',
				'layouts.layout.person',
				'layouts.layout.person',
				'layouts.layout.who',
				'layouts.credits.credit',
				'layouts.fans',
				'layouts.featured',
				'layouts.info.lines.who',
				'layouts.info.source',
				'layouts.local.parts.named',
				'layouts.meta.owner',
				'layouts.sections.content.host',
				'layouts.sections.content.host',
				'layouts.sponsor',
				'layouts.spots.spot',
				'logs.crew.member',
				'logs.desk.lead',
				'logs.entries.by',
				'memberships.customer',
				'notes.about',
				'orders.customer',
				'orders.items.handledBy',
				'orders.reviewedBy',
				'promo.face',
				'settings.featured',
				'settings.picks.backup',
				'settings.picks.customer',
				'settings.spotlight',
				'trips.participants',
			].sort()
		)
		expect(
			col.references.filter((ref) => ref.global).map((ref) => `${ref.collection}.${ref.path}`)
		).toEqual([
			'settings.featured',
			'settings.spotlight',
			'settings.picks.customer',
			'settings.picks.backup',
			'promo.face',
		])
	})

	it('moves references in every block type that holds them, and leaves a field of the same name in another alone', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Block Keeper', email: 'block-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Block Leaver', email: 'block-leaver@repoint.test' })
		const page = await create(LAYOUTS, {
			title: 'Blocks',
			layout: [
				{ blockType: 'note', person: String(absorbed.id) },
				{ blockType: 'quote', person: absorbed.id },
				{ blockType: 'shout', person: absorbed.id },
			],
		})
		const shoutOnly = await create(LAYOUTS, {
			title: 'Shout only',
			layout: [
				{ blockType: 'note', person: 'nobody' },
				{ blockType: 'shout', person: absorbed.id },
			],
		})

		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => [entry.path, entry.total])
		).toEqual([['layout.person', 2]])

		await merge(survivor, absorbed)
		const rowsOf = async (id: number | string) =>
			(
				((await booted.payload.findByID({ collection: LAYOUTS, id, depth: 0 })) as Doc).layout as {
					blockType: string
					person: unknown
				}[]
			).map((row) => [row.blockType, String(idOf(row.person))])
		expect(await rowsOf(page.id)).toEqual([
			['note', String(absorbed.id)],
			['quote', String(survivor.id)],
			['shout', String(survivor.id)],
		])
		expect(await rowsOf(shoutOnly.id)).toEqual([
			['note', 'nobody'],
			['shout', String(survivor.id)],
		])
	})

	it('moves references a path query would miss: wrong block, localized tab, rows in a localized group, a second shape', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Team Keeper', email: 'team-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Team Leaver', email: 'team-leaver@repoint.test' })
		const page = await create(LAYOUTS, {
			title: 'Team',
			layout: [
				{ blockType: 'gallery', items: [{ caption: 'Lake' }] },
				{ blockType: 'team', items: [{ person: absorbed.id }] },
			],
			meta: { owner: absorbed.id },
			info: { lines: [{ who: absorbed.id }] },
			sections: [{ content: [{ blockType: 'hosts', host: [absorbed.id] }] }],
		})

		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => entry.path)
				.sort()
		).toEqual(['info.lines.who', 'layout.items.person', 'meta.owner', 'sections.content.host'])

		await merge(survivor, absorbed)
		const doc = (await booted.payload.findByID({
			collection: LAYOUTS,
			id: page.id,
			depth: 0,
		})) as Doc
		const [, team] = doc.layout as { items: { person?: unknown }[] }[]
		const meta = doc.meta as { owner: unknown }
		const info = doc.info as { lines: { who: unknown }[] }
		const [section] = doc.sections as { content: { host: unknown[] }[] }[]
		const keep = String(survivor.id)
		expect([
			idOf(team?.items[0]?.person),
			idOf(meta.owner),
			idOf(info.lines[0]?.who),
			idOf(section?.content[0]?.host[0]),
		]).toEqual([keep, keep, keep, keep])
	})

	it('moves lists of references in a block that is not the first, as they are and in rows', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Cast Keeper', email: 'cast-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Cast Leaver', email: 'cast-leaver@repoint.test' })
		const page = await create(LAYOUTS, {
			title: 'Cast',
			layout: [
				{ blockType: 'cast', members: [absorbed.id] },
				{ blockType: 'roll', lines: [{ member: [absorbed.id] }] },
			],
		})

		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => entry.path)
				.sort()
		).toEqual(['layout.lines.member', 'layout.members'])

		await merge(survivor, absorbed)
		const doc = (await booted.payload.findByID({
			collection: LAYOUTS,
			id: page.id,
			depth: 0,
		})) as Doc
		const [cast, roll] = doc.layout as { members?: unknown[]; lines?: { member: unknown[] }[] }[]
		const keep = String(survivor.id)
		expect([idOf(cast?.members?.[0]), idOf(roll?.lines?.[0]?.member[0])]).toEqual([keep, keep])
	})

	it('moves polymorphic references with a value per locale, however they get it', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Poly Keeper', email: 'poly-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Poly Leaver', email: 'poly-leaver@repoint.test' })
		const pointer = { relationTo: 'customers', value: absorbed.id }
		const page = await create(LAYOUTS, {
			title: 'Poly',
			featured: pointer,
			fans: [pointer],
			spots: [{ spot: pointer }],
			credits: [{ credit: pointer }],
			info: { source: pointer },
		})

		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => entry.path)
				.sort()
		).toEqual(['credits.credit', 'fans', 'featured', 'info.source', 'spots.spot'])

		await merge(survivor, absorbed)
		const doc = (await booted.payload.findByID({
			collection: LAYOUTS,
			id: page.id,
			depth: 0,
		})) as Doc
		const value = (pointer: unknown) => idOf((pointer as { value: unknown } | undefined)?.value)
		const keep = String(survivor.id)
		expect([
			value(doc.featured),
			value((doc.fans as unknown[])[0]),
			value((doc.spots as { spot: unknown }[])[0]?.spot),
			value((doc.credits as { credit: unknown }[])[0]?.credit),
			value((doc.info as { source: unknown }).source),
		]).toEqual([keep, keep, keep, keep, keep])
	})

	it('moves a reference in a field hidden from the API', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Hidden Keeper', email: 'hidden-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Hidden Leaver', email: 'hidden-leaver@repoint.test' })
		const page = await create(LAYOUTS, { title: 'Sponsored', sponsor: absorbed.id })
		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => entry.path)
		).toEqual(['sponsor'])
		await merge(survivor, absorbed)
		const doc = (await booted.payload.findByID({
			collection: LAYOUTS,
			id: page.id,
			depth: 0,
			showHiddenFields: true,
		})) as Doc
		expect(idOf(doc.sponsor)).toBe(String(survivor.id))
	})

	it('lists a field of one name in several blocks once, a document in it once', async () => {
		const { customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Crowd Keeper', email: 'crowd-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Crowd Leaver', email: 'crowd-leaver@repoint.test' })
		await create(LAYOUTS, {
			title: 'Crowd',
			layout: [
				{ blockType: 'quote', person: absorbed.id },
				{ blockType: 'crowd', person: [absorbed.id] },
			],
		})
		const { references } = await plan(survivor, absorbed)
		const listed = (entries: { collection: string; path: string; total: number }[]) =>
			entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => [entry.path, entry.total])
		expect(listed(references.entries)).toEqual([['layout.person', 1]])
		expect(listed(references.linked[String(absorbed.id)] ?? [])).toEqual([['layout.person', 1]])

		const { mergeId } = await merge(survivor, absorbed)
		const record = (await fixture.booted.payload.db.findOne({
			collection: MERGES_SLUG,
			where: { id: { equals: mergeId } },
		})) as unknown as { repointed: { collection: string; path: string; ids: string[] }[] }
		expect(
			record.repointed
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => [entry.path, entry.ids.length])
		).toEqual([['layout.person', 1]])
	})

	it('moves references in blocks within rows, blocks and a localized group, and polymorphic ones in blocks', async () => {
		const { booted, customer } = fixture
		const LAYOUTS = 'layouts' as CollectionSlug
		const survivor = await customer({ name: 'Deep Keeper', email: 'deep-keeper@repoint.test' })
		const absorbed = await customer({ name: 'Deep Leaver', email: 'deep-leaver@repoint.test' })
		const page = await create(LAYOUTS, {
			title: 'Deep blocks',
			layout: [
				{ blockType: 'nest', inner: [{ blockType: 'deep', guest: absorbed.id }] },
				{ blockType: 'poly', who: { relationTo: 'customers', value: absorbed.id } },
			],
			sections: [{ content: [{ blockType: 'pick', host: absorbed.id }] }],
			local: { parts: [{ blockType: 'mention', named: absorbed.id }] },
		})

		const { references } = await plan(survivor, absorbed)
		expect(
			references.entries
				.filter((entry) => entry.collection === 'layouts')
				.map((entry) => [entry.path, entry.total])
				.sort()
		).toEqual(
			[
				['layout.inner.guest', 1],
				['layout.who', 1],
				['local.parts.named', 1],
				['sections.content.host', 1],
			].sort()
		)

		await merge(survivor, absorbed)
		const doc = (await booted.payload.findByID({
			collection: LAYOUTS,
			id: page.id,
			depth: 0,
		})) as Doc
		const keep = String(survivor.id)
		const [nest, poly] = doc.layout as { inner?: { guest: unknown }[]; who?: { value: unknown } }[]
		const [section] = doc.sections as { content: { host: unknown }[] }[]
		const local = doc.local as { parts: { named: unknown }[] }
		expect([
			idOf(nest?.inner?.[0]?.guest),
			idOf(poly?.who?.value),
			idOf(section?.content[0]?.host),
			idOf(local.parts[0]?.named),
		]).toEqual([keep, keep, keep, keep])
	})

	describe('references held in globals', () => {
		const SETTINGS = 'settings' as never
		const PROMO = 'promo' as never
		const readGlobal = (slug: never, locale = 'en', draft = false) =>
			fixture.booted.payload.findGlobal({
				slug,
				depth: 0,
				draft,
				locale: locale as never,
				fallbackLocale: false as never,
			}) as Promise<Record<string, unknown>>

		it('moves what a global points at, in every locale, and copies no locale into another', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({
				name: 'Global Keeper',
				email: 'global-keeper@repoint.test',
			})
			const absorbed = await customer({
				name: 'Global Leaver',
				email: 'global-leaver@repoint.test',
			})
			const other = await customer({ name: 'Global Other', email: 'global-other@repoint.test' })
			await booted.payload.updateGlobal({
				slug: SETTINGS,
				data: {
					featured: absorbed.id,
					spotlight: absorbed.id,
					picks: [
						{ customer: absorbed.id, backup: absorbed.id, note: 'english' },
						{ customer: other.id },
					],
				} as never,
				locale: 'en' as never,
			})
			// German has its own backup in the first row, and no note. Without `fallbackLocale`
			// Payload would fill German from English before it writes a global.
			const rows = (await readGlobal(SETTINGS)).picks as { id: string }[]
			await booted.payload.updateGlobal({
				slug: SETTINGS,
				data: {
					picks: [
						{ id: rows[0]?.id, customer: absorbed.id, backup: absorbed.id },
						{ id: rows[1]?.id, customer: other.id },
					],
				} as never,
				locale: 'de' as never,
				fallbackLocale: false as never,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(true)
			expect(
				references.entries
					.filter((entry) => entry.global)
					.map((entry) => [entry.collection, entry.path, entry.docs])
					.sort()
			).toEqual(
				[
					['settings', 'featured', [{ id: 'settings', title: 'Settings' }]],
					['settings', 'picks.backup', [{ id: 'settings', title: 'Settings' }]],
					['settings', 'picks.customer', [{ id: 'settings', title: 'Settings' }]],
					['settings', 'spotlight', [{ id: 'settings', title: 'Settings' }]],
				].sort()
			)

			const result = await merge(survivor, absorbed)
			const keep = String(survivor.id)
			const en = await readGlobal(SETTINGS)
			expect(idOf(en.featured)).toBe(keep)
			expect(idOf(en.spotlight)).toBe(keep)
			type Pick = { customer: unknown; backup?: unknown; note?: string | null }
			expect((en.picks as Pick[]).map((row) => idOf(row.customer))).toEqual([
				keep,
				String(other.id),
			])
			expect(idOf((en.picks as Pick[])[0]?.backup)).toBe(keep)
			const de = await readGlobal(SETTINGS, 'de')
			expect(de.spotlight ?? null).toBeNull()
			const [first] = de.picks as Pick[]
			expect([idOf(first?.backup), first?.note ?? null]).toEqual([keep, null])

			const record = (await booted.payload.db.findOne({
				collection: MERGES_SLUG,
				where: { id: { equals: result.mergeId } },
			})) as { repointed?: { collection: string; path: string; ids: string[]; global?: boolean }[] }
			expect(
				record.repointed
					?.filter((entry) => entry.global)
					.map((entry) => [entry.path, entry.ids])
					.sort()
			).toEqual(
				[
					['featured', ['settings']],
					['picks.backup', ['settings']],
					['picks.customer', ['settings']],
					['spotlight', ['settings']],
				].sort()
			)
		})

		it('refuses a merge while a global has unpublished changes, and keeps it published once they are gone', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Promo Keeper', email: 'promo-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Promo Leaver', email: 'promo-leaver@repoint.test' })
			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { headline: 'Live', face: absorbed.id, _status: 'published' } as never,
			})
			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { headline: 'Draft on top' } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(false)
			expect(references.blockers).toEqual([
				expect.objectContaining({
					collection: 'promo',
					global: true,
					reason: 'pendingDraft',
					doc: { id: 'promo', title: 'Promo' },
				}),
			])
			await expect(merge(survivor, absorbed)).rejects.toMatchObject({ status: 409 })

			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { headline: 'Live', _status: 'published' } as never,
			})
			await merge(survivor, absorbed)
			const promo = await readGlobal(PROMO, 'en', true)
			expect([idOf(promo.face), promo._status]).toEqual([String(survivor.id), 'published'])
		})

		skipForDb(
			'postgres',
			db,
			'refuses a merge while a global saved before drafts, without a status, has a draft on top',
			async () => {
				const { booted, customer } = fixture
				const survivor = await customer({ name: 'Old Promo Keeper', email: 'opk@repoint.test' })
				const absorbed = await customer({ name: 'Old Promo Leaver', email: 'opl@repoint.test' })
				await booted.payload.updateGlobal({
					slug: PROMO,
					data: { headline: 'Live', face: absorbed.id, _status: 'published' } as never,
				})
				// MongoDB keeps no status on a global saved before drafts were turned on.
				const globals = (
					booted.payload.db as unknown as {
						globals: { updateOne: (q: unknown, u: unknown) => Promise<unknown> }
					}
				).globals
				await globals.updateOne({ globalType: 'promo' }, { $unset: { _status: 1 } })
				await booted.payload.updateGlobal({
					slug: PROMO,
					data: { headline: 'Draft on top' } as never,
					draft: true,
				})
				try {
					const { references } = await plan(survivor, absorbed)
					expect(references.blockers).toEqual([
						expect.objectContaining({ collection: 'promo', global: true, reason: 'pendingDraft' }),
					])
				} finally {
					await booted.payload.updateGlobal({
						slug: PROMO,
						data: { headline: 'Live', face: null, _status: 'published' } as never,
					})
				}
			}
		)

		it('leaves a global taken off publication unpublished while it moves its pointer', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Off Keeper', email: 'off-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Off Leaver', email: 'off-leaver@repoint.test' })
			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { headline: 'Live', face: absorbed.id, _status: 'published' } as never,
			})
			// What the admin's Unpublish does.
			await booted.payload.updateGlobal({ slug: PROMO, data: { _status: 'draft' } as never })
			try {
				await merge(survivor, absorbed)
				const promo = await readGlobal(PROMO, 'en', true)
				expect([idOf(promo.face), promo._status]).toEqual([String(survivor.id), 'draft'])
			} finally {
				await booted.payload.updateGlobal({
					slug: PROMO,
					data: { headline: 'Live', face: null, _status: 'published' } as never,
				})
			}
		})

		it('refuses a merge while the published global points at a merged-in document and its newer draft does not', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Face Keeper', email: 'face-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Face Leaver', email: 'face-leaver@repoint.test' })
			const other = await customer({ name: 'Face Other', email: 'face-other@repoint.test' })
			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { headline: 'Live', face: absorbed.id, _status: 'published' } as never,
			})
			await booted.payload.updateGlobal({
				slug: PROMO,
				data: { face: other.id } as never,
				draft: true,
			})
			try {
				const { references, readyToApply } = await plan(survivor, absorbed)
				expect(readyToApply).toBe(false)
				expect(references.blockers).toEqual([
					expect.objectContaining({ collection: 'promo', global: true, reason: 'pendingDraft' }),
				])
			} finally {
				await booted.payload.updateGlobal({
					slug: PROMO,
					data: { face: null, _status: 'published' } as never,
				})
			}
		})
	})

	describe('references in values per locale', () => {
		const LOGS = 'logs' as CollectionSlug
		const readAll = (collection: CollectionSlug, id: number | string) =>
			fixture.booted.payload.findByID({
				collection,
				id,
				depth: 0,
				locale: 'all' as never,
			}) as Promise<Doc>

		it('moves references in the rows of a localized list and in a localized group, in every locale', async () => {
			const keep = await fixture.customer({ name: 'Crew Keeper', email: 'crew-k@repoint.test' })
			const gone = await fixture.customer({ name: 'Crew Leaver', email: 'crew-l@repoint.test' })
			const log = await create(LOGS, {
				title: 'Crew',
				crew: [{ member: gone.id }],
				desk: { lead: gone.id },
			})
			await fixture.booted.payload.update({
				collection: LOGS,
				id: log.id,
				locale: 'de' as never,
				data: { crew: [{ member: gone.id }], desk: { lead: gone.id } } as never,
			})
			await merge(keep, gone)
			const after = await readAll(LOGS, log.id)
			const crew = after.crew as Record<string, { member: unknown }[]>
			const desk = after.desk as Record<string, { lead: unknown }>
			expect(
				[crew.en?.[0]?.member, crew.de?.[0]?.member, desk.en?.lead, desk.de?.lead].map(idOf)
			).toEqual(Array(4).fill(String(keep.id)))
		})
	})

	describe('a clean merge', () => {
		let survivor: Doc
		let absorbed: Doc
		let order: Doc
		let rows: Doc
		let both: Doc
		let only: Doc
		let note: Doc
		let membership: Doc

		beforeAll(async () => {
			const { customer } = fixture
			survivor = await customer({ name: 'Repoint Keeper', email: 'keeper@repoint.test' })
			absorbed = await customer({ name: 'Repoint Leaver', email: 'leaver@repoint.test' })
			const clubA = await create(COMPANIES, { name: 'Club A' })
			const clubB = await create(COMPANIES, { name: 'Club B' })
			await create(ORDERS, { number: 'R-1', customer: survivor.id })
			order = await create(ORDERS, { number: 'R-2', customer: absorbed.id })
			rows = await create(ORDERS, {
				number: 'R-3',
				items: [
					{ product: 'Paddle', handledBy: absorbed.id },
					{ product: 'Helmet', handledBy: survivor.id },
				],
			})
			both = await create(TRIPS, { title: 'Both', participants: [survivor.id, absorbed.id] })
			only = await create(TRIPS, { title: 'Only', participants: [absorbed.id] })
			note = await create(NOTES, {
				text: 'Called',
				about: { relationTo: 'customers', value: absorbed.id },
				_status: 'published',
			})
			await create(MEMBERSHIPS, { title: 'A', customer: survivor.id, club: clubA.id })
			membership = await create(MEMBERSHIPS, { title: 'B', customer: absorbed.id, club: clubB.id })
		})

		it('previews what will move, and nothing stands in the way', async () => {
			const { references, readyToApply } = await plan(survivor, absorbed)
			const totals = Object.fromEntries(
				references.entries.map((entry) => [`${entry.collection}.${entry.path}`, entry.total])
			)
			expect(totals).toEqual({
				'memberships.customer': 1,
				'notes.about': 1,
				'orders.customer': 1,
				'orders.items.handledBy': 1,
				'trips.participants': 2,
			})
			expect(references.conflicts).toEqual([])
			expect(references.blockers).toEqual([])
			expect(readyToApply).toBe(true)
		})

		it('lists the documents that link to each document of the group, the survivor included', async () => {
			const { references } = await plan(survivor, absorbed)
			const linked = (doc: Doc) =>
				Object.fromEntries(
					(references.linked[String(doc.id)] ?? []).map((entry) => [
						`${entry.collection}.${entry.path}`,
						entry.docs.map((ref) => ref.title).sort(),
					])
				)
			expect(linked(survivor)).toEqual({
				'memberships.customer': ['A'],
				'orders.customer': ['R-1'],
				'orders.items.handledBy': ['R-3'],
				'trips.participants': ['Both'],
			})
			expect(linked(absorbed)).toEqual({
				'memberships.customer': ['B'],
				'notes.about': [expect.any(String)],
				'orders.customer': ['R-2'],
				'orders.items.handledBy': ['R-3'],
				'trips.participants': ['Both', 'Only'],
			})
		})

		it('moves every reference to the survivor and records it', async () => {
			const result = await merge(survivor, absorbed)
			const keep = String(survivor.id)
			expect(idOf((await read(ORDERS, order.id)).customer)).toBe(keep)
			const items = (await read(ORDERS, rows.id)).items as { handledBy: unknown }[]
			expect(items.map((item) => idOf(item.handledBy))).toEqual([keep, keep])
			expect(((await read(TRIPS, both.id)).participants as unknown[]).map(idOf)).toEqual([keep])
			expect(((await read(TRIPS, only.id)).participants as unknown[]).map(idOf)).toEqual([keep])
			const about = (await read(NOTES, note.id)).about as { relationTo: string; value: unknown }
			expect([about.relationTo, idOf(about.value)]).toEqual(['customers', keep])
			expect(idOf((await read(MEMBERSHIPS, membership.id)).customer)).toBe(keep)

			const record = (await fixture.booted.payload.db.findOne({
				collection: MERGES_SLUG,
				where: { id: { equals: result.mergeId } },
			})) as { repointed?: { collection: string; path: string; ids: string[] }[] }
			expect(record.repointed?.find((entry) => entry.collection === 'trips')?.ids).toHaveLength(2)
		})
	})

	describe('what stands in the way', () => {
		it('refuses a merge that would give one customer two memberships of a club', async () => {
			const { customer } = fixture
			const survivor = await customer({ name: 'Clash Keeper', email: 'clash-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Clash Leaver', email: 'clash-leaver@repoint.test' })
			const club = await create(COMPANIES, { name: 'Shared Club' })
			const kept = await create(MEMBERSHIPS, {
				title: 'Kept',
				customer: survivor.id,
				club: club.id,
			})
			const moving = await create(MEMBERSHIPS, {
				title: 'Moving',
				customer: absorbed.id,
				club: club.id,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(false)
			expect(references.conflicts).toEqual([
				expect.objectContaining({
					collection: 'memberships',
					fields: ['customer', 'club'],
					docs: [
						{ owner: String(survivor.id), doc: expect.objectContaining({ id: String(kept.id) }) },
						{ owner: String(absorbed.id), doc: expect.objectContaining({ id: String(moving.id) }) },
					],
				}),
			])
			await expect(merge(survivor, absorbed)).rejects.toMatchObject({ status: 409 })
		})

		it('refuses, naming the document, when one it would move no longer passes validation', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({
				name: 'Strict Keeper',
				email: 'strict-keeper@repoint.test',
			})
			const absorbed = await customer({
				name: 'Strict Leaver',
				email: 'strict-leaver@repoint.test',
			})
			// Saved before `text` became required, as the database layer still lets it be.
			const broken = (await booted.payload.db.create({
				collection: NOTES,
				data: { about: { relationTo: 'customers', value: absorbed.id }, _status: 'published' },
			})) as Doc
			try {
				await expect(merge(survivor, absorbed)).rejects.toMatchObject({
					status: 409,
					message: expect.stringContaining(String(broken.id)),
				})
			} finally {
				await booted.payload.db.deleteOne({
					collection: NOTES,
					where: { id: { equals: broken.id } },
				})
			}
		})

		it('refuses a merge while a referencing document has unpublished changes', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Draft Keeper', email: 'draft-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Draft Leaver', email: 'draft-leaver@repoint.test' })
			const pending = await create(NOTES, {
				text: 'Published',
				about: { relationTo: 'customers', value: absorbed.id },
				_status: 'published',
			})
			await booted.payload.update({
				collection: NOTES,
				id: pending.id,
				data: { text: 'Draft on top' } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(false)
			expect(references.blockers).toEqual([
				expect.objectContaining({
					collection: 'notes',
					reason: 'pendingDraft',
					doc: expect.objectContaining({ id: String(pending.id) }),
				}),
			])
			await expect(merge(survivor, absorbed)).rejects.toMatchObject({ status: 409 })
		})

		it('lets a document whose published state points at the survivor and newer draft at a merged-in one be', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Turn Keeper', email: 'turn-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Turn Leaver', email: 'turn-leaver@repoint.test' })
			const note = await create(NOTES, {
				text: 'Published',
				about: { relationTo: 'customers', value: survivor.id },
				_status: 'published',
			})
			await booted.payload.update({
				collection: NOTES,
				id: note.id,
				data: { about: { relationTo: 'customers', value: absorbed.id } } as never,
				draft: true,
			})
			const { references, readyToApply } = await plan(survivor, absorbed)
			expect([readyToApply, references.blockers]).toEqual([true, []])
		})

		it('moves a pointer only a newer draft holds, and leaves the published state as it was', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Fresh Keeper', email: 'fresh-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Fresh Leaver', email: 'fresh-leaver@repoint.test' })
			const other = await customer({ name: 'Fresh Other', email: 'fresh-other@repoint.test' })
			const note = await create(NOTES, {
				text: 'Published',
				about: { relationTo: 'customers', value: other.id },
				_status: 'published',
			})
			await booted.payload.update({
				collection: NOTES,
				id: note.id,
				data: { about: { relationTo: 'customers', value: absorbed.id } } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect([readyToApply, references.blockers]).toEqual([true, []])
			await merge(survivor, absorbed)
			const pointed = (doc: Doc) => idOf((doc.about as { value: unknown }).value)
			const published = (await booted.payload.findByID({
				collection: NOTES,
				id: note.id,
				depth: 0,
			})) as Doc
			expect([pointed(await read(NOTES, note.id)), pointed(published)]).toEqual([
				String(survivor.id),
				String(other.id),
			])
		})

		skipForDb(
			'postgres',
			db,
			'moves the pointer of a document saved before drafts in the state the site reads, and keeps it public',
			async () => {
				const { booted, customer } = fixture
				const survivor = await customer({
					name: 'Legacy Keeper',
					email: 'legacy-keeper@repoint.test',
				})
				const absorbed = await customer({
					name: 'Legacy Leaver',
					email: 'legacy-leaver@repoint.test',
				})
				const old = (await booted.payload.db.create({
					collection: NOTES,
					data: {
						text: 'from before drafts',
						about: { relationTo: 'customers', value: absorbed.id },
					},
				})) as Doc
				// MongoDB keeps no status on a document saved before drafts were turned on.
				const model = (
					booted.payload.db as unknown as {
						collections: Record<string, { updateOne: (q: unknown, u: unknown) => Promise<unknown> }>
					}
				).collections.notes
				await model?.updateOne({ _id: old.id }, { $unset: { _status: 1 } })

				await merge(survivor, absorbed)
				const main = (await booted.payload.findByID({
					collection: NOTES,
					id: old.id,
					depth: 0,
				})) as Doc
				expect(idOf((main.about as { value: unknown }).value)).toBe(String(survivor.id))
				const shown = await booted.payload.find({
					collection: NOTES,
					where: {
						and: [
							{ id: { equals: old.id } },
							{ or: [{ _status: { equals: 'published' } }, { _status: { exists: false } }] },
						],
					},
					depth: 0,
				})
				expect(shown.docs).toHaveLength(1)
			}
		)

		it('refuses a merge while a document whose status was cleared has a draft on top', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Old Note Keeper', email: 'on-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Old Note Leaver', email: 'on-leaver@repoint.test' })
			const old = (await booted.payload.db.create({
				collection: NOTES,
				data: {
					text: 'from before drafts',
					about: { relationTo: 'customers', value: absorbed.id },
					_status: null,
				},
			})) as Doc
			await booted.payload.update({
				collection: NOTES,
				id: old.id,
				data: { text: 'a draft on top' } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(false)
			expect(references.blockers).toEqual([
				expect.objectContaining({
					reason: 'pendingDraft',
					doc: expect.objectContaining({ id: String(old.id) }),
				}),
			])
		})

		it('lists nothing for a document never published whose first draft pointed at a merged-in one', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({
				name: 'Draft Note Keeper',
				email: 'dn-keeper@repoint.test',
			})
			const absorbed = await customer({
				name: 'Draft Note Leaver',
				email: 'dn-leaver@repoint.test',
			})
			const note = await create(
				NOTES,
				{ text: 'first', about: { relationTo: 'customers', value: absorbed.id } },
				true
			)
			await booted.payload.update({
				collection: NOTES,
				id: note.id,
				data: { text: 'second', about: null } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(references.entries.filter((entry) => entry.collection === 'notes')).toEqual([])
			expect(readyToApply).toBe(true)
		})

		it('refuses a merge while a published document points at a merged-in one and its newer draft does not', async () => {
			const { booted, customer } = fixture
			const survivor = await customer({ name: 'Stale Keeper', email: 'stale-keeper@repoint.test' })
			const absorbed = await customer({ name: 'Stale Leaver', email: 'stale-leaver@repoint.test' })
			const other = await customer({ name: 'Stale Other', email: 'stale-other@repoint.test' })
			const live = await create(NOTES, {
				text: 'Published',
				about: { relationTo: 'customers', value: absorbed.id },
				_status: 'published',
			})
			await booted.payload.update({
				collection: NOTES,
				id: live.id,
				data: { about: { relationTo: 'customers', value: other.id } } as never,
				draft: true,
			})

			const { references, readyToApply } = await plan(survivor, absorbed)
			expect(readyToApply).toBe(false)
			expect(references.blockers).toEqual([
				expect.objectContaining({
					collection: 'notes',
					reason: 'pendingDraft',
					doc: expect.objectContaining({ id: String(live.id) }),
				}),
			])
		})
	})
})

/** A reference moved in one locale leaves the other locales of its document as they were. */
describeForDb('dedupe repoint across locales', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	const LOGS = 'logs' as CollectionSlug
	const readAll = (collection: CollectionSlug, id: number | string) =>
		fixture.booted.payload.findByID({
			collection,
			id,
			depth: 0,
			locale: 'all' as never,
		}) as Promise<Doc>
	const idOf = (value: unknown) =>
		String(typeof value === 'object' && value !== null ? (value as { id: unknown }).id : value)

	const merge = (survivor: Doc, absorbed: Doc) =>
		applyMerge({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, 'customers'),
			survivorId: survivor.id,
			absorbedIds: [absorbed.id],
			choices: {},
		})

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('copies no value of one locale into another while it moves a reference', async () => {
		const { payload } = fixture.booted
		const keep = await fixture.customer({ name: 'Row Keeper', email: 'row-k@repoint.test' })
		const gone = await fixture.customer({ name: 'Row Keeper', email: 'row-l@repoint.test' })
		// Something for the merge to write in German, so the request ends in that locale.
		await payload.update({
			collection: 'customers' as CollectionSlug,
			id: gone.id,
			locale: 'de' as never,
			data: { name: 'Zeilenhalter' } as never,
		})
		const log = (await payload.create({
			collection: LOGS,
			locale: 'en' as never,
			data: { title: 'Memo', entries: [{ by: gone.id, memo: 'english memo' }] } as never,
			depth: 0,
		})) as Doc
		await merge(keep, gone)
		const [row] = (await readAll(LOGS, log.id)).entries as {
			by: unknown
			memo: Record<string, unknown>
		}[]
		expect(idOf(row?.by)).toBe(String(keep.id))
		expect(row?.memo.de ?? null).toBeNull()
	})

	it('leaves a localized reference unset where it was unset', async () => {
		const { payload } = fixture.booted
		const keep = await fixture.customer({ name: 'Order Keeper', email: 'order-k@repoint.test' })
		const gone = await fixture.customer({ name: 'Order Keeper', email: 'order-l@repoint.test' })
		const order = (await payload.create({
			collection: ORDERS,
			locale: 'en' as never,
			data: { number: 'LOC-1', reviewedBy: gone.id } as never,
			depth: 0,
		})) as Doc
		await merge(keep, gone)
		const reviewed = (await readAll(ORDERS, order.id)).reviewedBy as Record<string, unknown>
		expect(idOf(reviewed.en)).toBe(String(keep.id))
		expect(reviewed.de ?? null).toBeNull()
	})
})

/** A moved document of a collection the plugin compares is filed under the survivor. */
describeForDb('dedupe repoint into a compared collection', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				orders: { absorbed: 'delete', match: { fields: [{ path: 'customer', weight: 1 }] } },
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('indexes and pairs a document the merge moved, as it does the survivor', async () => {
		const { booted, customer } = fixture
		const create = (data: Record<string, unknown>) =>
			booted.payload.create({ collection: ORDERS, data: data as never, depth: 0 }) as Promise<Doc>
		const keep = await customer({ name: 'Order Keep', email: 'order-keep@compared.test' })
		const gone = await customer({ name: 'Order Gone', email: 'order-gone@compared.test' })
		const first = await create({ number: 'C-1', customer: keep.id })
		const second = await create({ number: 'C-2', customer: gone.id })
		await applyMerge({
			req: fixture.req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'customers'),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		const keys = async (id: number | string) =>
			(await fixture.keysFor(id, 'orders')).map((row) => row.key).sort()
		expect(await keys(second.id)).toEqual(await keys(first.id))
		const pairs = await booted.payload.db.find<{ pairKey: string }>({
			collection: PAIRS_SLUG,
			where: { pairKey: { equals: pairKeyFor('orders', first.id, second.id) } },
			pagination: false,
		})
		expect(pairs.docs).toHaveLength(1)
	})
})

/** With the jobs queue on, a moved document is checked by a job, after the merge commits. */
describeForDb('dedupe repoint into a compared collection, on the jobs queue', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			disableJobsQueue: false,
			collections: {
				...pluginOptions.collections,
				orders: { absorbed: 'delete', match: { fields: [{ path: 'customer', weight: 1 }] } },
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('files a moved document at once and pairs it once its job runs', async () => {
		const { booted, customer } = fixture
		const runJobs = () => booted.payload.jobs.run({ queue: 'dedupe' })
		const create = (data: Record<string, unknown>) =>
			booted.payload.create({ collection: ORDERS, data: data as never, depth: 0 }) as Promise<Doc>
		const keep = await customer({ name: 'Queued Keep', email: 'queued-keep@compared.test' })
		const gone = await customer({ name: 'Queued Gone', email: 'queued-gone@compared.test' })
		const first = await create({ number: 'Q-1', customer: keep.id })
		const second = await create({ number: 'Q-2', customer: gone.id })
		await runJobs()
		await applyMerge({
			req: fixture.req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'customers'),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		const keys = async (id: number | string) =>
			(await fixture.keysFor(id, 'orders')).map((row) => row.key).sort()
		const pairs = async () =>
			(
				await booted.payload.db.find({
					collection: PAIRS_SLUG,
					where: { pairKey: { equals: pairKeyFor('orders', first.id, second.id) } },
					pagination: false,
				})
			).docs
		expect(await keys(second.id)).toEqual(await keys(first.id))
		expect(await pairs()).toHaveLength(0)
		await runJobs()
		expect(await pairs()).toHaveLength(1)
	})
})
