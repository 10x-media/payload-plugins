import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { MERGES_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import {
	AGENTS,
	bootDedupe,
	CUSTOMERS,
	type Doc,
	FRAGILE,
	KITS,
	reqFor,
	STAFF,
	VAULTS,
} from './fixtures'

/** What a merge may write, and who may see it: the checks that keep a reviewer inside their access. */
describeForDb('dedupe merge guards', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	const ctx = () => getContext(fixture.booted.payload)
	const create = (collection: CollectionSlug, data: Record<string, unknown>) =>
		fixture.booted.payload.create({ collection, data: data as never, depth: 0 }) as Promise<Doc>
	const group = (
		req: PayloadRequest,
		collection: CollectionSlug,
		[survivor, ...absorbed]: (number | string)[]
	) => ({
		req,
		ctx: ctx(),
		col: getCollectionContext(fixture.booted.payload, collection),
		survivorId: survivor as number | string,
		absorbedIds: absorbed,
		choices: {} as Record<string, MergeChoice>,
	})
	const valuesOf = (decisions: { key: string; values: { value: unknown }[] }[], key: string) =>
		decisions.find((decision) => decision.key === key)?.values.map(({ value }) => value)

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('sends no values of a field the reader may not read, on the plan', async () => {
		const pair = [
			await create(STAFF, { name: 'Salaried', salary: 1000 }),
			await create(STAFF, { name: 'Salaried', salary: 2000 }),
		]
		const limited = await reqFor(fixture.booted, 'limited-staff@example.com')
		const plan = await buildPlanResponse(
			group(
				limited,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		expect(valuesOf(plan.decisions, 'salary')).toEqual([undefined, undefined])
	})

	it('keeps the primary value of a field that hides the value on the document it would come from', async () => {
		const pair = [
			await create(STAFF, { name: 'Sealed twin' }),
			await create(STAFF, { name: 'Sealed twin', sealed: true, homePhone: '555-0100' }),
		]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		const phone = plan.decisions.find((entry) => entry.key === 'homePhone')
		expect(phone?.values[1]?.value).toBeUndefined()
		expect(phone?.proposed ?? null).toBeNull()

		await applyMerge(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		const merged = (await fixture.booted.payload.findByID({
			collection: STAFF,
			id: pair[0]?.id as string,
			depth: 0,
		})) as Doc
		expect(merged.homePhone ?? null).toBeNull()
	})

	it('still clears a pointer at its own merge in a field it keeps for what the field hides', async () => {
		const gone = await create(STAFF, { name: 'Buddy twin', sealed: true, buddy: null })
		const keep = await create(STAFF, { name: 'Buddy twin', buddy: gone.id })
		await applyMerge(group(fixture.req, STAFF, [keep.id, gone.id]))
		const merged = (await fixture.booted.payload.findByID({
			collection: STAFF,
			id: keep.id,
			depth: 0,
		})) as Doc
		expect(merged.buddy ?? null).toBeNull()
	})

	it('keeps the primary value where a third document would show a value the field hides', async () => {
		const trio = [
			await create(STAFF, { name: 'Sealed trio', sealed: true }),
			await create(STAFF, { name: 'Sealed trio', sealed: true, homePhone: 'A-secret' }),
			await create(STAFF, { name: 'Sealed trio', sealed: false }),
		] as [Doc, Doc, Doc]
		await applyMerge({
			...group(
				fixture.req,
				STAFF,
				trio.map((doc) => doc.id)
			),
			choices: { homePhone: { doc: String(trio[1].id) }, sealed: { doc: String(trio[2].id) } },
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: STAFF,
			id: trio[0].id,
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		})) as Doc
		expect(merged.homePhone ?? null).toBeNull()
	})

	it('leaves a field the reviewer may not read on the primary out of the screen and their choices', async () => {
		const pair = [
			await create(STAFF, { name: 'Blind salary', salary: 5000 }),
			await create(STAFF, { name: 'Blind salary' }),
		] as [Doc, Doc]
		const limited = await reqFor(fixture.booted, 'limited-blind@example.com')
		const plan = await buildPlanResponse(
			group(
				limited,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'salary')?.hidden).toBe(true)
		await applyMerge({
			...group(
				limited,
				STAFF,
				pair.map((doc) => doc.id)
			),
			choices: { salary: { doc: String(pair[1].id) } },
		})
		const merged = (await fixture.booted.payload.findByID({
			collection: STAFF,
			id: pair[0].id,
			depth: 0,
		})) as Doc
		expect(merged.salary).toBe(5000)
	})

	it('lets rows through when the primary would show less of them than their own document', async () => {
		const pair = [
			await create(STAFF, { name: 'Sealed rows', sealed: true }),
			await create(STAFF, { name: 'Sealed rows', bonuses: [{ label: 'open', sealedNote: 'n' }] }),
		] as [Doc, Doc]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'bonuses')?.policy).not.toBe('survivor')
	})

	it('lets a manual field the reviewer may not read on the primary stand by its policy', async () => {
		const pair = [
			await create(KITS, { name: 'Manual secret', title: 'm1', ref: 'm1', secret: 1 }),
			await create(KITS, { name: 'Manual secret', title: 'm2', ref: 'm2', secret: 2 }),
		] as [Doc, Doc]
		const limited = await reqFor(fixture.booted, 'limited-manual@example.com')
		const plan = await buildPlanResponse(
			group(
				limited,
				KITS,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'secret')?.hidden).toBe(true)
		expect(plan.readyToApply).toBe(true)
	})

	it('hides a field the reviewer may neither read nor change on the primary', async () => {
		const pair = [
			await create(KITS, { name: 'Fixed secret', title: 'f1', ref: 'f1', secret: 1 }),
			await create(KITS, { name: 'Fixed secret', title: 'f2', ref: 'f2' }),
		] as [Doc, Doc]
		const fixed = await reqFor(fixture.booted, 'limited-fixed@example.com')
		const plan = await buildPlanResponse(
			group(
				fixed,
				KITS,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'secret')?.hidden).toBe(true)
	})

	it('leaves a pointer alone in rows the reviewer may not change, kept for what they hide too', async () => {
		const gone = await create(KITS, { name: 'Crew pal', title: 'c1', ref: 'c1', sealed: true })
		const keep = await create(KITS, {
			name: 'Crew pal',
			title: 'c2',
			ref: 'c2',
			crew: [{ label: 'mate', pal: gone.id }],
		})
		await applyMerge(group(fixture.req, KITS, [keep.id, gone.id]))
		const merged = (await fixture.booted.payload.findByID({
			collection: KITS,
			id: keep.id,
			depth: 0,
		})) as Doc
		expect((merged.crew as { pal?: unknown }[])[0]?.pal).toBe(gone.id)
	})

	it('lets rows through when what their document hides of them is empty', async () => {
		const pair = [
			await create(STAFF, { name: 'Empty seal' }),
			await create(STAFF, { name: 'Empty seal', sealed: true, bonuses: [{ label: 'plain' }] }),
		] as [Doc, Doc]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'bonuses')?.policy).not.toBe('survivor')
	})

	it('lets rows through when what their document hides of them is rich text left empty', async () => {
		const empty = {
			root: {
				type: 'root',
				direction: null,
				format: '',
				indent: 0,
				version: 1,
				children: [
					{
						type: 'paragraph',
						direction: null,
						format: '',
						indent: 0,
						version: 1,
						textFormat: 0,
						children: [],
					},
				],
			},
		}
		const pair = [
			await create(STAFF, { name: 'Empty rich seal' }),
			await create(STAFF, {
				name: 'Empty rich seal',
				sealed: true,
				bonuses: [{ label: 'plain', sealedRich: empty }],
			}),
		] as [Doc, Doc]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		expect(plan.decisions.find((entry) => entry.key === 'bonuses')?.policy).not.toBe('survivor')
	})

	it('waits for a document of the group another editor has open', async () => {
		const pair = [
			await create(STAFF, { name: 'Locked twin' }),
			await create(STAFF, { name: 'Locked twin' }),
		] as [Doc, Doc]
		const editor = await fixture.booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'editor-lock@example.com', password: 'password' } as never,
		})
		const lock = await fixture.booted.payload.db.create({
			collection: 'payload-locked-documents' as CollectionSlug,
			data: {
				document: { relationTo: STAFF, value: pair[1].id },
				user: { relationTo: 'users', value: editor.id },
			},
		})
		try {
			const args = group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
			const plan = await buildPlanResponse(args)
			expect(plan.blocked).toMatch(/open for editing by editor-lock@example\.com/)
			expect(plan.readyToApply).toBe(false)
			await expect(applyMerge(args)).rejects.toMatchObject({ status: 409 })
		} finally {
			await fixture.booted.payload.db.deleteOne({
				collection: 'payload-locked-documents' as CollectionSlug,
				where: { id: { equals: lock.id } },
			})
		}
	})

	it('treats a lock its editor left behind as another editor holding it', async () => {
		const pair = [
			await create(STAFF, { name: 'Orphan lock' }),
			await create(STAFF, { name: 'Orphan lock' }),
		] as [Doc, Doc]
		const editor = await fixture.booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'editor-gone@example.com', password: 'password' } as never,
		})
		const lock = await fixture.booted.payload.db.create({
			collection: 'payload-locked-documents' as CollectionSlug,
			data: {
				document: { relationTo: STAFF, value: pair[1].id },
				user: { relationTo: 'users', value: editor.id },
			},
		})
		await fixture.booted.payload.delete({ collection: 'users' as CollectionSlug, id: editor.id })
		try {
			const plan = await buildPlanResponse(
				group(
					fixture.req,
					STAFF,
					pair.map((doc) => doc.id)
				)
			)
			expect(plan.blocked).toMatch(/open for editing/)
		} finally {
			await fixture.booted.payload.db.deleteOne({
				collection: 'payload-locked-documents' as CollectionSlug,
				where: { id: { equals: lock.id } },
			})
		}
	})

	it('names no field the reviewer may not read on the primary among the pointers it clears', async () => {
		const gone = await create(STAFF, { name: 'Sealed buddy' })
		const keep = await create(STAFF, { name: 'Sealed buddy', sealed: true, buddy: gone.id })
		const plan = await buildPlanResponse(group(fixture.req, STAFF, [keep.id, gone.id]))
		expect(plan.decisions.find((entry) => entry.key === 'buddy')?.hidden).toBe(true)
		expect(plan.cleared).not.toContain('buddy')
	})

	it('sends no values of a field inside rows the reader may not read, on the plan', async () => {
		const pair = [
			await create(STAFF, { name: 'Bonused', bonuses: [{ label: 'spring', amount: 4711 }] }),
			await create(STAFF, { name: 'Bonused', bonuses: [{ label: 'autumn', amount: 4712 }] }),
		]
		const limited = await reqFor(fixture.booted, 'limited-bonus@example.com')
		const ids = pair.map((doc) => doc.id)
		const plan = await buildPlanResponse(group(limited, STAFF, ids))
		const planned = JSON.stringify(plan.decisions.find((entry) => entry.key === 'bonuses'))
		expect(planned).toContain('autumn')
		expect(planned).not.toContain('4711')
		expect(planned).not.toContain('4712')
	})

	it('keeps the survivor rows when the reviewer may not change a field inside them', async () => {
		const pair = [
			await create(STAFF, { name: 'Approved', bonuses: [{ label: 'ours', approvedBy: 'Ada' }] }),
			await create(STAFF, { name: 'Approved', bonuses: [{ label: 'theirs', approvedBy: 'Bob' }] }),
		]
		const limited = await reqFor(fixture.booted, 'limited-approver@example.com')
		const plan = await buildPlanResponse({
			...group(
				limited,
				STAFF,
				pair.map((doc) => doc.id)
			),
			choices: { bonuses: { items: [{ doc: String(pair[1]?.id), index: 0 }] } },
		})
		const proposed = plan.decisions.find((entry) => entry.key === 'bonuses')?.proposed as {
			label: string
		}[]
		expect(proposed.map((row) => row.label)).toEqual(['ours'])
	})

	it('asks the access of a field inside a row with that row, as Payload does', async () => {
		const pair = [
			await create(STAFF, {
				name: 'Noted',
				bonuses: [{ label: 'hush', private: true, note: 'hidden-note' }],
			}),
			await create(STAFF, {
				name: 'Noted',
				bonuses: [{ label: 'open', private: false, note: 'shown-note' }],
			}),
		]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		const planned = JSON.stringify(plan.decisions.find((entry) => entry.key === 'bonuses'))
		expect(planned).toContain('shown-note')
		expect(planned).not.toContain('hidden-note')
	})

	it('keeps out of the plan a field no one may read, in a list per locale inside a row', async () => {
		const pair = [
			await create(STAFF, {
				name: 'Audited',
				bonuses: [{ label: 'a', audits: [{ secret: 'hidden-audit' }] }],
			}),
			await create(STAFF, {
				name: 'Audited',
				bonuses: [{ label: 'b', audits: [{ secret: 'other-audit' }] }],
			}),
		]
		const plan = await buildPlanResponse(
			group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			)
		)
		const planned = JSON.stringify(plan.decisions.find((entry) => entry.key === 'bonuses'))
		expect(planned).not.toContain('hidden-audit')
		expect(planned).not.toContain('other-audit')
		expect(planned).toContain('"label":"a"')
	})

	it('keeps the survivor rows when a list per locale inside them holds a field no one may change', async () => {
		const pair = [
			await create(STAFF, {
				name: 'Frozen',
				bonuses: [{ label: 'ours', audits: [{ frozen: 'x' }] }],
			}),
			await create(STAFF, {
				name: 'Frozen',
				bonuses: [{ label: 'theirs', audits: [{ frozen: 'y' }] }],
			}),
		]
		const plan = await buildPlanResponse({
			...group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			),
			choices: { bonuses: { items: [{ doc: String(pair[1]?.id), index: 0 }] } },
		})
		const proposed = plan.decisions.find((entry) => entry.key === 'bonuses')?.proposed as {
			label: string
		}[]
		expect(proposed.map((row) => row.label)).toEqual(['ours'])
	})

	it('keeps the survivor rows when a row the reviewer could pick may not be changed', async () => {
		const pair = [
			await create(STAFF, { name: 'Locked', bonuses: [{ label: 'ours', reviewer: 'Ada' }] }),
			await create(STAFF, {
				name: 'Locked',
				bonuses: [{ label: 'theirs', locked: true, reviewer: 'Bob' }],
			}),
		]
		const plan = await buildPlanResponse({
			...group(
				fixture.req,
				STAFF,
				pair.map((doc) => doc.id)
			),
			choices: { bonuses: { items: [{ doc: String(pair[1]?.id), index: 0 }] } },
		})
		const proposed = plan.decisions.find((entry) => entry.key === 'bonuses')?.proposed as {
			label: string
		}[]
		expect(proposed.map((row) => row.label)).toEqual(['ours'])
	})

	it('lets a reviewer who may only move documents to the trash merge into the trash', async () => {
		const keep = await create(STAFF, { name: 'Trash Only' })
		const gone = await create(STAFF, { name: 'Trash Only' })
		const limited = await reqFor(fixture.booted, 'limited-trasher@example.com')
		await applyMerge(group(limited, STAFF, [keep.id, gone.id]))
		const trashed = (await fixture.booted.payload.findByID({
			collection: STAFF,
			id: gone.id,
			trash: true,
			depth: 0,
		})) as Doc
		expect(Boolean(trashed.deletedAt)).toBe(true)
	})

	it('refuses to move to the trash a document the reviewer may not change, and says so in the plan', async () => {
		const keep = await create(STAFF, { name: 'Keeper staff', grade: 'mine' })
		const other = await create(STAFF, { name: 'Keeper staff', grade: 'theirs' })
		const keeper = await reqFor(fixture.booted, 'keeper-trash@example.com')
		const args = group(keeper, STAFF, [keep.id, other.id])
		expect((await buildPlanResponse(args)).refusal).toBe(`You may not remove document ${other.id}.`)
		await expect(applyMerge(args)).rejects.toMatchObject({ status: 403 })
	})

	it('refuses to merge a document the reviewer may not read', async () => {
		const keep = await create(VAULTS, { name: 'Own vault', owner: 'owner-apply@example.com' })
		const other = await create(VAULTS, { name: 'Other vault', owner: 'someone@example.com' })
		const owner = await reqFor(fixture.booted, 'owner-apply@example.com')
		await expect(applyMerge(group(owner, VAULTS, [keep.id, other.id]))).rejects.toMatchObject({
			status: 403,
		})
	})

	it('names a document by its id to a reader who may not read its title field', async () => {
		const keep = await create(AGENTS, { codename: 'Falcon', desk: 'North' })
		const gone = await create(AGENTS, { codename: 'Falcon', desk: 'South' })
		const ids = [keep.id, gone.id]
		const limited = await reqFor(fixture.booted, 'limited-titles@example.com')
		expect(
			(await buildPlanResponse(group(limited, AGENTS, ids))).docs.map((doc) => doc.title)
		).toEqual(ids.map(String))
		expect(
			(await buildPlanResponse(group(fixture.req, AGENTS, ids))).docs.map((doc) => doc.title)
		).toEqual(['Falcon', 'Falcon'])
	})

	it('keeps the survivor value of a field the reviewer may not change, whatever they pick', async () => {
		const pair = [
			await create(STAFF, { name: 'Graded', grade: 'junior' }),
			await create(STAFF, { name: 'Graded', grade: 'senior' }),
		]
		const limited = await reqFor(fixture.booted, 'limited-grader@example.com')
		const plan = await buildPlanResponse({
			...group(
				limited,
				STAFF,
				pair.map((doc) => doc.id)
			),
			choices: { grade: { doc: String(pair[1]?.id) } },
		})
		expect(plan.decisions.find((entry) => entry.key === 'grade')?.proposed).toBe('junior')
	})

	it('refuses a group of two tenants already at the plan', async () => {
		const pair = [
			await fixture.customer({ name: 'Split Tenant', email: 'split1@guard.test', tenant: 'north' }),
			await fixture.customer({ name: 'Split Tenant', email: 'split2@guard.test', tenant: 'south' }),
		]
		await expect(
			buildPlanResponse(
				group(
					fixture.req,
					CUSTOMERS,
					pair.map((doc) => doc.id)
				)
			)
		).rejects.toMatchObject({ status: 400 })
	})

	it('refuses a group over the limit before looking at any document', async () => {
		const owner = await reqFor(fixture.booted, 'owner-d@example.com')
		const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
		await expect(buildPlanResponse(group(owner, VAULTS, ids))).rejects.toMatchObject({
			status: 400,
		})
	})

	it('marks the merge record failed when the merge fails halfway without a transaction', async () => {
		const survivor = await create(FRAGILE, { title: 'keeps', seat: 1 })
		const absorbed = await create(FRAGILE, { title: 'boom', seat: 2 })
		const database = fixture.booted.payload.db as { beginTransaction?: unknown }
		const begin = database.beginTransaction
		database.beginTransaction = async () => null
		try {
			await expect(
				applyMerge({
					...group(fixture.req, FRAGILE, [survivor.id, absorbed.id]),
					choices: { seat: { doc: String(absorbed.id) }, title: { doc: String(absorbed.id) } },
				})
			).rejects.toThrow('boom')
		} finally {
			database.beginTransaction = begin
		}
		const { docs } = await fixture.booted.payload.db.find({
			collection: MERGES_SLUG,
			where: { survivor: { equals: String(survivor.id) } },
			limit: 1,
		})
		expect((docs[0] as unknown as { status: string }).status).toBe('failed')
	})

	it('says at the plan that the merge cannot apply when transactions are required and missing', async () => {
		const pair = [
			await fixture.customer({ name: 'Required Tx', email: 'tx1@guard.test' }),
			await fixture.customer({ name: 'Required Tx', email: 'tx2@guard.test' }),
		]
		const options = ctx().options as { requireTransactions: boolean }
		// What a database without transactions answers, `transactionOptions: false` included.
		const database = fixture.booted.payload.db
		const begin = database.beginTransaction
		options.requireTransactions = true
		database.beginTransaction = async () => null
		try {
			const plan = await buildPlanResponse(
				group(
					fixture.req,
					CUSTOMERS,
					pair.map((doc) => doc.id)
				)
			)
			expect([plan.readyToApply, plan.transactions]).toEqual([false, 'refused'])
		} finally {
			options.requireTransactions = false
			database.beginTransaction = begin
		}
	})
})

/** What the apply would refuse, the plan says first, so the merge screen never offers it. */
describeForDb('dedupe merge guards, told by the plan', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			access: {
				merge: ({ req }) =>
					!String((req.user as { email?: string } | null)?.email).startsWith('limited'),
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('tells a reviewer who may not merge before they try', async () => {
		const create = (data: Record<string, unknown>) =>
			fixture.booted.payload.create({
				collection: STAFF,
				data: data as never,
				depth: 0,
			}) as Promise<Doc>
		const keep = await create({ name: 'Plan Guard' })
		const gone = await create({ name: 'Plan Guard' })
		const limited = await reqFor(fixture.booted, 'limited-planner@example.com')
		const args = {
			req: limited,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, STAFF),
			survivorId: keep.id,
			absorbedIds: [gone.id],
			choices: {},
		}
		const plan = await buildPlanResponse(args)
		expect([plan.readyToApply, plan.refusal]).toEqual([false, 'You may not merge documents.'])
		await expect(applyMerge(args)).rejects.toMatchObject({ status: 403 })
	})
})
