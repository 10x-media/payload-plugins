import { describeForDb, skipForDb } from '@10x-media/payload-test-harness'
import {
	APIError,
	type CollectionBeforeChangeHook,
	type CollectionSlug,
	createLocalReq,
	createPayloadRequest,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { runScan } from '../../src/queue/scan'
import type { MergeChoice } from '../../src/schema/types'
import {
	ARTICLES,
	bootDedupe,
	COMPANIES,
	CUSTOMERS,
	type Doc,
	emitted,
	GUIDES,
	LEADS,
	MANUALS,
	PAGES,
	reqFor,
	STAFF,
	TICKETS,
} from './fixtures'

/** The plan a reviewer sees and the apply that follows it. */
describeForDb('dedupe merge', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	describe('plan and apply', () => {
		let acme: Doc
		let survivor: Doc
		let absorbed: Doc

		beforeAll(async () => {
			const { booted, customer } = fixture
			acme = (await booted.payload.create({
				collection: COMPANIES,
				data: { name: 'Acme' } as never,
			})) as Doc
			survivor = await customer({
				name: 'Anna Schmidt',
				email: 'anna@mail.com',
				phone: '111',
				tags: ['x'],
				vip: false,
				addresses: [{ city: 'Berlin', street: 'A 1' }],
				profile: { score: 1 },
				internalNote: 'ours',
			})
			absorbed = await customer({
				name: 'Anna Schmidt',
				email: 'anna.schmidt@mail.com',
				phone: '+380 44 333 22 11',
				tags: ['y', 'x'],
				company: acme.id,
				addresses: [
					{ city: 'Berlin', street: 'A 1' },
					{ city: 'Hamburg', street: 'B 2' },
				],
				profile: { bio: 'Hallo', score: 2 },
				extra: { code: 'K' },
				internalNote: 'theirs',
			})
			await booted.payload.update({
				collection: CUSTOMERS,
				id: absorbed.id,
				data: { name: 'Anna Schmidt (DE)', profile: { bio: 'Hallo DE' } } as never,
				locale: 'de' as never,
				depth: 0,
			})
		})

		it('plans per locale, unions lists, flags conflicts and resolves related titles', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			const plan = await buildPlanResponse({
				req,
				ctx,
				col,
				survivorId: survivor.id,
				absorbedIds: [absorbed.id],
				choices: {},
			})
			const byKey = new Map(plan.decisions.map((decision) => [decision.key, decision]))

			expect(byKey.get('name@en')).toMatchObject({ source: 'same', changed: false })
			expect(byKey.get('name@de')).toMatchObject({
				source: String(absorbed.id),
				proposed: 'Anna Schmidt (DE)',
				changed: true,
			})
			expect(byKey.get('profile.bio@de')).toMatchObject({ proposed: 'Hallo DE', changed: true })
			// A list keeps the survivor's own rows until the reviewer checks others.
			expect(byKey.get('tags')).toMatchObject({ source: String(survivor.id), proposed: ['x'] })
			expect(byKey.get('addresses')?.proposed).toHaveLength(1)
			expect(byKey.get('phone')).toMatchObject({ conflict: true, requiresChoice: false })
			expect(byKey.get('email')).toMatchObject({ conflict: true, proposed: 'anna@mail.com' })
			expect(byKey.get('profile.score')).toMatchObject({ conflict: true, requiresChoice: true })
			expect(byKey.get('company')).toMatchObject({
				source: String(absorbed.id),
				relationLabels: { [String(acme.id)]: 'Acme' },
			})
			expect(byKey.get('extra.code')).toMatchObject({ proposed: 'K', label: 'Code' })
			expect(plan.readyToApply).toBe(false)
			expect(plan.docs[0]?.title).toBe('Anna Schmidt')
		})

		it('sends no values for a field the admin hides', async () => {
			const { booted, req } = fixture
			const plan = await buildPlanResponse({
				req,
				ctx: getContext(booted.payload),
				col: getCollectionContext(booted.payload, 'customers'),
				survivorId: survivor.id,
				absorbedIds: [absorbed.id],
				choices: {},
			})
			const note = plan.decisions.find((decision) => decision.key === 'internalNote')
			expect(note?.hidden).toBe(true)
			expect(JSON.stringify(plan)).not.toContain('theirs')
			expect(JSON.stringify(plan)).not.toContain('ours')
		})

		it('refuses to plan for a reader the collection does not let read', async () => {
			const { booted } = fixture
			const limited = await reqFor(booted, 'limited@example.com')
			const keep = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'r@b.co' } as never,
			})) as Doc
			const drop = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'r@b.co', source: 'ad' } as never,
			})) as Doc
			await expect(
				buildPlanResponse({
					req: limited,
					ctx: getContext(booted.payload),
					col: getCollectionContext(booted.payload, 'leads'),
					survivorId: keep.id,
					absorbedIds: [drop.id],
					choices: {},
				})
			).rejects.toMatchObject({ status: 403 })
		})

		it('refuses to apply while a manual conflict is open', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			await expect(
				applyMerge({
					req,
					ctx,
					col,
					survivorId: survivor.id,
					absorbedIds: [absorbed.id],
					choices: {},
				})
			).rejects.toMatchObject({ status: 400 })
		})

		it('refuses to apply when a document moved since it was planned', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			await expect(
				applyMerge({
					req,
					ctx,
					col,
					survivorId: survivor.id,
					absorbedIds: [absorbed.id],
					choices: { 'profile.score': { doc: String(absorbed.id) } },
					expected: { [String(survivor.id)]: '2000-01-01T00:00:00.000Z' },
				})
			).rejects.toMatchObject({ status: 409 })
		})

		it('applies the merge: survivor updated in every locale, absorbed trashed and freed', async () => {
			const { booted, req, keysFor, pairsFor } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			const result = await applyMerge({
				req,
				ctx,
				col,
				survivorId: survivor.id,
				absorbedIds: [absorbed.id],
				choices: {
					'profile.score': { doc: String(absorbed.id) },
					phone: { doc: String(absorbed.id) },
					email: { doc: String(absorbed.id) },
					tags: {
						items: [
							{ doc: String(survivor.id), index: 0 },
							{ doc: String(absorbed.id), index: 0 },
						],
					},
					addresses: {
						items: [
							{ doc: String(survivor.id), index: 0 },
							{ doc: String(absorbed.id), index: 1 },
						],
					},
				},
			})
			expect(result.survivorId).toBe(String(survivor.id))
			expect(emitted.at(-1)).toMatchObject({ type: 'merge.applied', survivorId: result.survivorId })

			const merged = (await booted.payload.findByID({
				collection: CUSTOMERS,
				id: survivor.id,
				depth: 0,
				locale: 'all',
			})) as Doc
			expect(merged.email).toBe('anna.schmidt@mail.com')
			expect(merged.phone).toBe('+380 44 333 22 11')
			expect(merged.tags).toEqual(['x', 'y'])
			expect(merged.name).toEqual({ en: 'Anna Schmidt', de: 'Anna Schmidt (DE)' })
			expect((merged.profile as { bio: unknown; score: number }).score).toBe(2)
			expect((merged.profile as { bio: Record<string, unknown> }).bio.de).toBe('Hallo DE')
			expect(String(merged.company as { id?: unknown } | string | number)).toContain(
				String(acme.id)
			)
			expect((merged.addresses as unknown[]).length).toBe(2)
			expect((merged.extra as { code: string }).code).toBe('K')

			// The survivor is indexed again with the values it took over, so the next
			// look-alike is found by them.
			const keys = (await keysFor(survivor.id)).map((row) => row.key)
			expect(keys).toEqual(
				expect.arrayContaining(['phone=443332211', 'email=anna.schmidt@mail.com'])
			)
			expect(keys).not.toContain('email=anna@mail.com')

			const gone = (await booted.payload.findByID({
				collection: CUSTOMERS,
				id: absorbed.id,
				depth: 0,
				trash: true,
				overrideAccess: true,
			})) as Doc
			expect(gone.deletedAt).toBeTruthy()
			expect(gone.email).toBe(`merged-${absorbed.id}.anna.schmidt@mail.com.invalid`)

			const hidden = await booted.payload.findByID({
				collection: CUSTOMERS,
				id: absorbed.id,
				depth: 0,
				disableErrors: true,
			})
			expect(hidden).toBeNull()

			expect(await keysFor(absorbed.id)).toHaveLength(0)

			expect(await pairsFor(absorbed.id)).toEqual([])
		})

		it('rejects a merge with a trashed document', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'customers')
			await expect(
				applyMerge({
					req,
					ctx,
					col,
					survivorId: absorbed.id,
					absorbedIds: [survivor.id],
					choices: {},
				})
			).rejects.toBeInstanceOf(APIError)
		})

		it('hard-deletes the absorbed document on a collection without trash', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'leads')
			const keep = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'a@b.co' } as never,
			})) as Doc
			const drop = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'a@b.co', source: 'ad' } as never,
			})) as Doc
			await applyMerge({ req, ctx, col, survivorId: keep.id, absorbedIds: [drop.id], choices: {} })
			const merged = (await booted.payload.findByID({ collection: LEADS, id: keep.id })) as Doc
			expect(merged.source).toBe('ad')
			expect(
				await booted.payload.findByID({ collection: LEADS, id: drop.id, disableErrors: true })
			).toBeNull()
		})

		it('writes a list whose rows hold values per locale into every locale, taken rows too', async () => {
			const { booted, req } = fixture
			const { payload } = booted
			const staff = (data: Record<string, unknown>) =>
				payload.create({ collection: STAFF, data: data as never, depth: 0 }) as Promise<Doc>
			const ours = await staff({
				name: 'Tagged',
				bonuses: [{ label: 'ours', tagline: 'hello', memos: [{ text: 'm1' }] }],
			})
			const [row] = ours.bonuses as { id: string }[]
			await payload.update({
				collection: STAFF,
				id: ours.id,
				locale: 'de' as never,
				data: {
					bonuses: [{ id: row?.id, label: 'ours', tagline: 'hallo', memos: [{ text: 'm1 de' }] }],
				} as never,
			})
			const theirs = await staff({
				name: 'Tagged',
				bonuses: [{ label: 'theirs', tagline: 'hi', memos: [{ text: 'm2' }] }],
			})
			const [their] = theirs.bonuses as { id: string }[]
			await payload.update({
				collection: STAFF,
				id: theirs.id,
				locale: 'de' as never,
				data: {
					bonuses: [
						{ id: their?.id, label: 'theirs', tagline: 'hallo-theirs', memos: [{ text: 'm2 de' }] },
					],
				} as never,
			})
			const group = {
				req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'staff'),
				survivorId: ours.id,
				absorbedIds: [theirs.id],
				choices: {
					bonuses: {
						items: [
							{ doc: String(ours.id), index: 0 },
							{ doc: String(theirs.id), index: 0 },
						],
					},
				},
			}
			const plan = await buildPlanResponse(group)
			const shown = plan.decisions.find((entry) => entry.key === 'bonuses')?.values[0]?.value as {
				tagline: unknown
			}[]
			expect(shown[0]?.tagline).toBe('hello')

			await applyMerge(group)
			type Row = {
				label: string
				tagline: Record<string, string>
				memos: Record<string, { text: string }[]>
			}
			const rows = (
				(await payload.findByID({
					collection: STAFF,
					id: ours.id,
					depth: 0,
					locale: 'all' as never,
				})) as unknown as { bonuses: Row[] }
			).bonuses
			expect(rows.map((entry) => entry.label)).toEqual(['ours', 'theirs'])
			expect(rows[0]?.tagline).toMatchObject({ en: 'hello', de: 'hallo' })
			expect(rows[0]?.memos.en?.map((memo) => memo.text)).toEqual(['m1'])
			expect(rows[0]?.memos.de?.map((memo) => memo.text)).toEqual(['m1 de'])
			expect(rows[1]?.tagline).toMatchObject({ en: 'hi', de: 'hallo-theirs' })
			expect(rows[1]?.memos.en?.map((memo) => memo.text)).toEqual(['m2'])
			expect(rows[1]?.memos.de?.map((memo) => memo.text)).toEqual(['m2 de'])
		})

		it("shows a list's values per locale in the reader's locale, and leaves the request's locale be", async () => {
			const { booted } = fixture
			const { payload } = booted
			const staff = (data: Record<string, unknown>) =>
				payload.create({ collection: STAFF, data: data as never, depth: 0 }) as Promise<Doc>
			const ours = await staff({ name: 'Worded', bonuses: [{ label: 'ours', tagline: 'hello' }] })
			const [row] = ours.bonuses as { id: string }[]
			await payload.update({
				collection: STAFF,
				id: ours.id,
				locale: 'de' as never,
				data: { bonuses: [{ id: row?.id, label: 'ours', tagline: 'hallo' }] } as never,
			})
			const theirs = await staff({ name: 'Worded', bonuses: [{ label: 'theirs', tagline: 'hi' }] })
			const de = await createLocalReq({ locale: 'de', user: fixture.req.user as never }, payload)
			const plan = await buildPlanResponse({
				req: de,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'staff'),
				survivorId: ours.id,
				absorbedIds: [theirs.id],
				choices: {},
			})
			const shown = plan.decisions.find((entry) => entry.key === 'bonuses')?.values[0]?.value as {
				tagline: unknown
			}[]
			expect(shown[0]?.tagline).toBe('hallo')
			expect(de.locale).toBe('de')
			expect(de.query?.depth).toBeUndefined()
		})

		it('plans with the request Payload builds for a REST call, a web Request underneath', async () => {
			const { payload } = fixture.booted
			const req = await createPayloadRequest({
				config: payload.config,
				request: new Request('http://localhost/api/dedupe/plan?locale=de', { method: 'POST' }),
			})
			req.user = fixture.req.user
			const pair = [
				await fixture.customer({ name: 'Web Request', email: 'web-a@mail.com' }),
				await fixture.customer({ name: 'Web Request', email: 'web-b@mail.com' }),
			]
			const plan = await buildPlanResponse({
				req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'customers'),
				survivorId: pair[0]?.id as string,
				absorbedIds: [pair[1]?.id as string],
				choices: {},
			})
			expect(plan.docs.map((doc) => doc.id)).toEqual(pair.map((doc) => String(doc?.id)))
			expect(req.locale).toBe('de')
		})

		it("leaves the request's locale be through the references a plan and a scan read per locale", async () => {
			const { payload } = fixture.booted
			const en = await createLocalReq({ locale: 'en', user: fixture.req.user as never }, payload)
			const ctx = getContext(payload)
			const col = getCollectionContext(payload, 'customers')
			const pair = [
				await fixture.customer({ name: 'Locale Keeper', email: 'keeper-a@mail.com' }),
				await fixture.customer({ name: 'Locale Keeper', email: 'keeper-b@mail.com' }),
			]
			await buildPlanResponse({
				req: en,
				ctx,
				col,
				survivorId: pair[0]?.id as string,
				absorbedIds: [pair[1]?.id as string],
				choices: {},
			})
			expect(en.locale).toBe('en')
			await runScan({ req: en, ctx, col })
			expect(en.locale).toBe('en')
		})

		it('lets go of a unique value in a list per locale inside a row the survivor takes', async () => {
			const { booted, req } = fixture
			const { payload } = booted
			const staff = (data: Record<string, unknown>) =>
				payload.create({ collection: STAFF, data: data as never, depth: 0 }) as Promise<Doc>
			const ours = await staff({ name: 'Coded', bonuses: [{ label: 'ours' }] })
			const theirs = await staff({
				name: 'Coded',
				bonuses: [{ label: 'theirs', memos: [{ text: 'coded', code: 'M-1' }] }],
			})
			await applyMerge({
				req,
				ctx: getContext(payload),
				col: getCollectionContext(payload, 'staff'),
				survivorId: ours.id,
				absorbedIds: [theirs.id],
				choices: { bonuses: { items: [{ doc: String(theirs.id), index: 0 }] } },
			})
			const merged = (await payload.findByID({
				collection: STAFF,
				id: ours.id,
				depth: 0,
			})) as unknown as {
				bonuses: { memos: { code: string }[] }[]
			}
			expect(merged.bonuses[0]?.memos.map((memo) => memo.code)).toEqual(['M-1'])
		})

		it('clears a field when the reviewer picks the document that has it empty', async () => {
			const { booted, req } = fixture
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'leads')
			const keep = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'clear@b.co', source: 'ad' } as never,
			})) as Doc
			const drop = (await booted.payload.create({
				collection: LEADS,
				data: { email: 'clear@b.co' } as never,
			})) as Doc
			await applyMerge({
				req,
				ctx,
				col,
				survivorId: keep.id,
				absorbedIds: [drop.id],
				choices: { source: { doc: String(drop.id) } },
			})
			const merged = (await booted.payload.findByID({ collection: LEADS, id: keep.id })) as Doc
			expect(merged.source ?? null).toBeNull()
		})
	})

	describe('drafts', () => {
		const article = (data: Record<string, unknown>, draft = false) =>
			fixture.booted.payload.create({
				collection: ARTICLES,
				data: { _status: draft ? 'draft' : 'published', ...data } as never,
				draft,
				depth: 0,
			}) as Promise<Doc>

		it('refuses to merge the published state while the survivor has a newer draft', async () => {
			const { booted, req } = fixture
			const keep = await article({ title: 'Trains', summary: 'published text' })
			const drop = await article({ title: 'Trains', summary: 'the same, twice' })
			await booted.payload.update({
				collection: ARTICLES,
				id: keep.id,
				data: { title: 'Trains (draft)' } as never,
				draft: true,
				depth: 0,
			})

			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'articles')
			// The screen says so before the reviewer gets as far as the button.
			const args = { req, ctx, col, survivorId: keep.id, absorbedIds: [drop.id], choices: {} }
			await expect(buildPlanResponse(args)).resolves.toMatchObject({
				readyToApply: false,
				survivorDraft: true,
			})
			await expect(applyMerge(args)).rejects.toMatchObject({ status: 409 })

			// Nothing was published: the public title is the one it had, the draft is still there.
			const published = (await booted.payload.findByID({
				collection: ARTICLES,
				id: keep.id,
				depth: 0,
			})) as Doc
			expect(published.title).toBe('Trains')
			const latest = (await booted.payload.findByID({
				collection: ARTICLES,
				id: keep.id,
				draft: true,
				depth: 0,
			})) as Doc
			expect(latest.title).toBe('Trains (draft)')
		})

		it('refuses a document never published when the published state is merged', async () => {
			const { booted, req } = fixture
			const keep = await article({ title: 'Planes' })
			const drop = (await booted.payload.create({
				collection: ARTICLES,
				data: { title: 'Planes', summary: 'first draft', _status: 'draft' } as never,
				draft: true,
				depth: 0,
			})) as Doc
			await booted.payload.update({
				collection: ARTICLES,
				id: drop.id,
				data: { summary: 'latest draft' } as never,
				draft: true,
				depth: 0,
			})

			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'articles')
			const args = { req, ctx, col, survivorId: keep.id, absorbedIds: [drop.id], choices: {} }
			await expect(buildPlanResponse(args)).rejects.toMatchObject({ status: 409 })
			await expect(applyMerge(args)).rejects.toMatchObject({ status: 409 })
		})

		it('merges a document whose status was cleared, which counts as published', async () => {
			const { booted, req } = fixture
			const keep = await article({ title: 'Boats' })
			const old = (await booted.payload.db.create({
				collection: ARTICLES,
				data: { title: 'Boats', summary: 'from before drafts', _status: null },
			})) as Doc
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'articles')
			const args = { req, ctx, col, survivorId: keep.id, absorbedIds: [old.id], choices: {} }
			await expect(buildPlanResponse(args)).resolves.toMatchObject({ survivor: String(keep.id) })
		})

		it('merges the published state when nothing is pending', async () => {
			const { booted, req } = fixture
			const keep = await article({ title: 'Ships' })
			const drop = await article({ title: 'Ships', summary: 'from the copy' })
			const ctx = getContext(booted.payload)
			const col = getCollectionContext(booted.payload, 'articles')
			await applyMerge({ req, ctx, col, survivorId: keep.id, absorbedIds: [drop.id], choices: {} })
			const merged = (await booted.payload.findByID({
				collection: ARTICLES,
				id: keep.id,
				depth: 0,
			})) as Doc
			expect(merged.summary).toBe('from the copy')
			expect(merged._status).toBe('published')
		})
	})

	it('draws rich text as the version view does: Lexical as HTML, a related document by title', async () => {
		const { booted, req } = fixture
		const acme = (await booted.payload.create({
			collection: COMPANIES,
			data: { name: 'Acme Rich' } as never,
		})) as Doc
		const text = (value: string, format = 0) => ({
			type: 'text',
			text: value,
			format,
			style: '',
			mode: 'normal',
			detail: 0,
			version: 1,
		})
		const block = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
			type,
			children,
			direction: 'ltr',
			format: '',
			indent: 0,
			version: 1,
			...extra,
		})
		const body = (...children: unknown[]) => ({ root: block('root', children) })
		const page = async (value: unknown) =>
			(await booted.payload.create({
				collection: PAGES,
				data: { title: 'Rich', body: value } as never,
			})) as Doc
		const first = await page(
			body(
				block('heading', [text('Opening hours')], { tag: 'h2' }),
				block('paragraph', [text('Open '), text('daily', 1)], { textFormat: 0 }),
				{ type: 'relationship', relationTo: 'companies', value: acme.id, format: '', version: 2 }
			)
		)
		const second = await page(body(block('paragraph', [text('Closed')], { textFormat: 0 })))

		const plan = await buildPlanResponse({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'pages'),
			survivorId: first.id,
			absorbedIds: [second.id],
			choices: {},
		})
		const html = plan.decisions.find((decision) => decision.key === 'body')?.html
		expect(html?.[String(first.id)]).toContain('<h2')
		expect(html?.[String(first.id)]).toContain('<strong>daily</strong>')
		expect(html?.[String(first.id)]).toContain('lexical-relationship-diff')
		expect(html?.[String(first.id)]).toContain('Acme Rich')
		expect(html?.[String(second.id)]).toContain('Closed')

		// A related document the reviewer may not read is not named.
		const limited = await reqFor(booted, 'limited-rich@example.com')
		const theirs = await buildPlanResponse({
			req: limited,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'pages'),
			survivorId: first.id,
			absorbedIds: [second.id],
			choices: {},
		})
		expect(
			theirs.decisions.find((decision) => decision.key === 'body')?.html?.[String(first.id)]
		).not.toContain('Acme Rich')
	})

	it("hands the host's hooks a context of the merge's own, not one shared by every merge", async () => {
		const { booted } = fixture
		const customers = booted.payload.collections[CUSTOMERS]
		if (!customers) throw new Error('no customers collection')
		const hooks = customers.config.hooks
		const found: unknown[] = []
		const touch: CollectionBeforeChangeHook = ({ context, data }) => {
			found.push(context.touched)
			context.touched = true
			return data
		}
		const mergeTwins = async (label: string) => {
			// A request as an endpoint gets one: nothing in its context yet.
			const req = await reqFor(booted, `${label}@example.com`)
			const pair = [
				await fixture.customer({ name: 'Context Twin', email: `${label}-a@mail.com`, phone: '1' }),
				await fixture.customer({ name: 'Context Twin', email: `${label}-b@mail.com`, phone: '2' }),
			]
			found.length = 0
			await applyMerge({
				req,
				ctx: getContext(booted.payload),
				col: getCollectionContext(booted.payload, 'customers'),
				survivorId: pair[0]?.id as string,
				absorbedIds: [pair[1]?.id as string],
				choices: { phone: { doc: String(pair[1]?.id) } },
			})
			return found[0]
		}
		hooks.beforeChange.push(touch)
		try {
			await mergeTwins('context-one')
			expect(await mergeTwins('context-two')).toBeUndefined()
		} finally {
			hooks.beforeChange.splice(hooks.beforeChange.indexOf(touch), 1)
		}
	})

	it('leaves the request it was given unmarked, so what the host writes with it later is indexed', async () => {
		const { booted } = fixture
		const req = await reqFor(booted, 'mark@example.com')
		const keep = await fixture.customer({ name: 'Mark Twin', email: 'mark-a@mail.com', phone: '1' })
		const gone = await fixture.customer({ name: 'Mark Twin', email: 'mark-b@mail.com', phone: '2' })
		await applyMerge({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'customers'),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		const keys = async () => (await fixture.keysFor(keep.id, 'customers')).map((row) => row.key)
		const before = await keys()
		await booted.payload.update({
			collection: CUSTOMERS,
			id: keep.id,
			data: { email: 'mark-new@mail.com' } as never,
			req,
		})
		expect(await keys()).not.toEqual(before)
	})

	it('clears a pointer the survivor holds at a document of its own merge', async () => {
		const { booted, req } = fixture
		const gone = await fixture.customer({ name: 'Referred Twin', email: 'ref-b@mail.com' })
		const keep = await fixture.customer({
			name: 'Referred Twin',
			email: 'ref-a@mail.com',
			referredBy: gone.id,
		})
		await applyMerge({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'customers'),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		const merged = (await booted.payload.findByID({
			collection: CUSTOMERS,
			id: keep.id,
			depth: 0,
		})) as Doc
		expect(merged.referredBy ?? null).toBeNull()
	})

	it('clears a pointer at a document of its own merge in a field hidden in the admin too', async () => {
		const { booted, req } = fixture
		const TEAMS = 'teams' as CollectionSlug
		const create = (data: Record<string, unknown>) =>
			booted.payload.create({ collection: TEAMS, data: data as never }) as Promise<Doc>
		const gone = await create({ name: 'Hidden parent' })
		const keep = await create({ name: 'Hidden parent', parent: gone.id })
		const plan = await buildPlanResponse({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, TEAMS),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		expect(plan.cleared).toContain('parent')
		await applyMerge({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, TEAMS),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})
		const merged = (await booted.payload.findByID({
			collection: TEAMS,
			id: keep.id,
			depth: 0,
		})) as Doc
		expect(merged.parent ?? null).toBeNull()
	})

	it('clears the pointers at its own documents inside rows and a localized group too, and says where', async () => {
		const { booted, req } = fixture
		const TEAMS = 'teams' as CollectionSlug
		const gone = (await booted.payload.create({
			collection: TEAMS,
			data: { name: 'Self Rows' } as never,
			depth: 0,
		})) as Doc
		const keep = (await booted.payload.create({
			collection: TEAMS,
			locale: 'en' as never,
			data: {
				name: 'Self Rows',
				members: [{ person: 'Ann', mentor: gone.id, backup: gone.id }],
				card: { title: 'Card', rival: gone.id },
			} as never,
			depth: 0,
		})) as Doc
		const args = {
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, 'teams'),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		}
		expect((await buildPlanResponse(args)).cleared.sort()).toEqual(['card@en', 'members'])

		await applyMerge(args)
		const merged = (await booted.payload.findByID({
			collection: TEAMS,
			id: keep.id,
			locale: 'all' as never,
			depth: 0,
		})) as Doc
		const [row] = merged.members as { person: string; mentor: unknown; backup: unknown }[]
		const card = (merged.card as Record<string, { title: string; rival: unknown }>).en
		expect([
			row?.person,
			row?.mentor ?? null,
			(row?.backup as Record<string, unknown>)?.en ?? null,
		]).toEqual(['Ann', null, null])
		expect([card?.title, card?.rival ?? null]).toEqual(['Card', null])
	})

	it('keeps the fields hidden from the API in the rows it takes from a merged-in document, a unique one too', async () => {
		const { booted, req } = fixture
		const create = (data: Record<string, unknown>) =>
			booted.payload.create({ collection: TICKETS, data: data as never }) as Promise<Doc>
		const keep = await create({ title: 'Stub twin', stubs: [{ code: 'A', barcode: 'a-1' }] })
		const gone = await create({ title: 'Stub twin', stubs: [{ code: 'B', barcode: 'b-1' }] })
		await applyMerge({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, TICKETS),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {
				stubs: {
					items: [
						{ doc: String(keep.id), index: 0 },
						{ doc: String(gone.id), index: 0 },
					],
				},
			},
		})
		const merged = (await booted.payload.findByID({
			collection: TICKETS,
			id: keep.id,
			depth: 0,
			showHiddenFields: true,
		})) as Doc
		expect((merged.stubs as Doc[]).map(({ code, barcode }) => [code, barcode])).toEqual([
			['A', 'a-1'],
			['B', 'b-1'],
		])
	})

	it('keeps a field hidden from the API in a group of a row it takes from a merged-in document', async () => {
		const { booted, req } = fixture
		const create = (data: Record<string, unknown>) =>
			booted.payload.create({ collection: TICKETS, data: data as never }) as Promise<Doc>
		const keep = await create({
			title: 'Serial twin',
			stubs: [{ code: 'A', extra: { serial: 's-a' } }],
		})
		const gone = await create({
			title: 'Serial twin',
			stubs: [{ code: 'B', extra: { serial: 's-b' } }],
		})
		await applyMerge({
			req,
			ctx: getContext(booted.payload),
			col: getCollectionContext(booted.payload, TICKETS),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {
				stubs: {
					items: [
						{ doc: String(keep.id), index: 0 },
						{ doc: String(gone.id), index: 0 },
					],
				},
			},
		})
		const merged = (await booted.payload.findByID({
			collection: TICKETS,
			id: keep.id,
			depth: 0,
			showHiddenFields: true,
		})) as Doc
		expect(
			(merged.stubs as Array<Doc & { extra?: { serial?: string } }>).map((row) => [
				row.code,
				row.extra?.serial,
			])
		).toEqual([
			['A', 's-a'],
			['B', 's-b'],
		])
	})

	skipForDb(
		'postgres',
		db,
		'gives a row that shares its id with a row of another document no hidden field of either',
		async () => {
			const { booted, req } = fixture
			const create = (data: Record<string, unknown>) =>
				booted.payload.create({ collection: TICKETS, data: data as never }) as Promise<Doc>
			// A copy made with its row ids, as a raw import does; on SQL a row id is unique.
			const shared = '6a0000000000000000000001'
			const keep = await create({
				title: 'Cloned stub',
				stubs: [{ id: shared, code: 'B', extra: { serial: 's-keep' } }],
			})
			const gone = await create({
				title: 'Cloned stub',
				stubs: [{ id: shared, code: 'B', extra: { serial: 's-gone' } }],
			})
			await applyMerge({
				req,
				ctx: getContext(booted.payload),
				col: getCollectionContext(booted.payload, TICKETS),
				survivorId: keep.id,
				absorbedIds: [gone.id],
				choices: {
					stubs: {
						items: [
							{ doc: String(keep.id), index: 0 },
							{ doc: String(gone.id), index: 0 },
						],
					},
				},
			})
			const merged = (await booted.payload.findByID({
				collection: TICKETS,
				id: keep.id,
				depth: 0,
				showHiddenFields: true,
			})) as Doc
			const serials = (merged.stubs as Array<{ extra?: { serial?: string } }>).map(
				(row) => row.extra?.serial ?? null
			)
			expect(serials[0]).toBe('s-keep')
			expect(serials[1]).not.toBe('s-keep')
		}
	)

	describe('a title required in every language', () => {
		// Through the database layer: Payload saves no language that leaves the title empty.
		const guide = async (
			title: { en: string; de?: string },
			steps: { en: string; de?: string }[]
		) => {
			const { payload } = fixture.booted
			const doc = (await payload.create({
				collection: GUIDES,
				data: { title: title.en, steps: steps.map((step) => ({ text: step.en })) } as never,
			})) as Doc
			const raw = (await payload.db.findOne({
				collection: GUIDES,
				where: { id: { equals: doc.id } },
				locale: 'all',
				joins: false,
			})) as Doc
			const rows = raw.steps as { id: string }[]
			const { id: _, ...rest } = raw
			await payload.db.updateOne({
				collection: GUIDES,
				id: doc.id,
				data: {
					...rest,
					// A language without the title holds no row of it on SQL, where it is NOT NULL.
					title: title.de ? { en: title.en, de: title.de } : { en: title.en },
					steps: steps.map((step, index) => ({
						id: rows[index]?.id,
						text: { en: step.en, de: step.de ?? null },
					})),
				},
			})
			return doc
		}
		const both = (keep: Doc, gone: Doc) => ({
			steps: {
				items: [
					{ doc: String(keep.id), index: 0 },
					{ doc: String(gone.id), index: 0 },
				],
			},
		})
		const merge = (keep: Doc, gone: Doc, choices: Record<string, MergeChoice>) => ({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, GUIDES),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices,
		})
		const stored = (id: number | string) =>
			fixture.booted.payload.findByID({
				collection: GUIDES,
				id,
				depth: 0,
				locale: 'all' as never,
			}) as Promise<Doc>

		it('writes rows into no language they hold nothing in', async () => {
			const keep = await guide({ en: 'Kept' }, [{ en: 'k1' }])
			const gone = await guide({ en: 'Gone' }, [{ en: 'g1' }])
			await applyMerge(merge(keep, gone, both(keep, gone)))
			const merged = await stored(keep.id)
			expect(
				(merged.steps as { text: Record<string, string> }[]).map((row) => row.text.en)
			).toEqual(['k1', 'g1'])
		})

		it('takes a required value the primary lacks in a written language from the most similar document', async () => {
			const keep = await guide({ en: 'Kept' }, [{ en: 'k1' }])
			const gone = await guide({ en: 'Gone', de: 'Weg' }, [{ en: 'g1', de: 'g1 de' }])
			const plan = await buildPlanResponse(merge(keep, gone, both(keep, gone)))
			expect(plan.filled).toEqual(['title@de'])
			await applyMerge(merge(keep, gone, both(keep, gone)))
			expect((await stored(keep.id)).title).toEqual({ en: 'Kept', de: 'Weg' })
		})

		it('refuses when no document has the required value in a language it writes', async () => {
			const keep = await guide({ en: 'Kept' }, [{ en: 'k1' }])
			const gone = await guide({ en: 'Gone' }, [{ en: 'g1', de: 'g1 de' }])
			const plan = await buildPlanResponse(merge(keep, gone, both(keep, gone)))
			expect(plan.readyToApply).toBe(false)
			expect(plan.blocked).toMatch(/"Title" in de/)
			await expect(applyMerge(merge(keep, gone, both(keep, gone)))).rejects.toMatchObject({
				status: 409,
			})
		})
	})

	describe('values required in each language it writes', () => {
		type Locales = Record<string, string>
		// Through the database layer: Payload saves no language that leaves a required value empty.
		const manual = async (doc: {
			title: Locales
			code: Locales
			motto: Locales
			subtitle?: Locales
			sealed?: boolean
			steps?: Locales[]
		}) => {
			const { payload } = fixture.booted
			const created = (await payload.create({
				collection: MANUALS,
				data: {
					title: 'seed',
					code: 'seed',
					motto: 'seed',
					steps: (doc.steps ?? []).map(() => ({ text: 'seed' })),
				} as never,
			})) as Doc
			const raw = (await payload.db.findOne({
				collection: MANUALS,
				where: { id: { equals: created.id } },
				locale: 'all',
				joins: false,
			})) as Doc
			const rows = (raw.steps ?? []) as { id: string }[]
			const { id: _, ...rest } = raw
			await payload.db.updateOne({
				collection: MANUALS,
				id: created.id,
				data: {
					...rest,
					title: doc.title,
					code: doc.code,
					motto: doc.motto,
					subtitle: doc.subtitle ?? {},
					sealed: doc.sealed ?? false,
					steps: (doc.steps ?? []).map((text, index) => ({ id: rows[index]?.id, text })),
				},
			})
			return created
		}
		const merge = (keep: Doc, gone: Doc) => ({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, MANUALS),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		})

		it('refuses where the primary keeps its rows and a field the merge may not fill empty there', async () => {
			const keep = await manual({
				title: { en: 'K' },
				code: { en: 'k' },
				motto: { en: 'km' },
				steps: [{ en: 'k1' }],
			})
			const gone = await manual({
				title: { en: 'G', de: 'G de' },
				code: { en: 'g', de: 'g de' },
				motto: { en: 'gm', de: 'gm de' },
				steps: [{ en: 'g1', de: 'g1 de' }],
			})
			const plan = await buildPlanResponse(merge(keep, gone))
			expect(plan.readyToApply).toBe(false)
			expect(plan.blocked).toMatch(/"Code" in de/)
			expect(plan.blocked).toMatch(/"Steps > Text" in de/)
			await expect(applyMerge(merge(keep, gone))).rejects.toMatchObject({ status: 409 })
		})

		it('takes no required value from a document whose field hides it', async () => {
			const keep = await manual({
				title: { en: 'K' },
				code: { en: 'k' },
				motto: { en: 'km' },
			})
			const gone = await manual({
				title: { en: 'G', de: 'G de' },
				code: { en: 'g', de: 'g de' },
				motto: { en: 'gm', de: 'secret de' },
				subtitle: { de: 'sub de' },
				sealed: true,
			})
			const plan = await buildPlanResponse(merge(keep, gone))
			const motto = plan.decisions.find((entry) => entry.key === 'motto@de')
			expect(motto?.proposed ?? null).toBeNull()
			expect(plan.blocked).toMatch(/"Motto" in de/)
		})

		it('leaves the default language alone where only another one changes', async () => {
			const keep = await manual({ title: { de: 'K de' }, code: { de: 'k' }, motto: { de: 'km' } })
			const gone = await manual({
				title: { de: 'G de' },
				code: { de: 'g' },
				motto: { de: 'gm' },
				subtitle: { de: 'sub de' },
			})
			const plan = await buildPlanResponse(merge(keep, gone))
			expect(plan.blocked).toBeNull()
			expect(plan.readyToApply).toBe(true)
		})
	})

	it('frees a unique value only when the survivor takes it, so merges in a row all apply', async () => {
		const { req, customer, booted } = fixture
		const ctx = getContext(booted.payload)
		const col = getCollectionContext(booted.payload, 'customers')
		for (const round of [1, 2]) {
			const keep = await customer({ name: `Row ${round}`, email: `keep-${round}@row.test` })
			const drop = await customer({ name: `Row ${round}`, email: `drop-${round}@row.test` })
			await applyMerge({ req, ctx, col, survivorId: keep.id, absorbedIds: [drop.id], choices: {} })
			const gone = (await booted.payload.findByID({
				collection: CUSTOMERS,
				id: drop.id,
				trash: true,
				depth: 0,
			})) as Doc
			expect(gone.email).toBe(`drop-${round}@row.test`)
		}
	})
})
