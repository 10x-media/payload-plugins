import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { MERGES_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { readMergeRecord, readMerges } from '../../src/merge/record'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import { bootDedupe, CUSTOMERS, type Doc, LEADS, reqFor, TICKETS } from './fixtures'

const ORDERS = 'orders' as CollectionSlug

/** The history of merges as the admin reads it: the list, and one record in full. */
describeForDb('dedupe merge history', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>

	const ctx = () => getContext(fixture.booted.payload)
	const merge = (
		collection: CollectionSlug,
		[survivor, ...absorbed]: Doc[],
		choices: Record<string, MergeChoice> = {}
	) =>
		applyMerge({
			req: fixture.req,
			ctx: ctx(),
			col: getCollectionContext(fixture.booted.payload, collection),
			survivorId: survivor?.id as number | string,
			absorbedIds: absorbed.map((doc) => doc.id),
			choices,
		})
	const withTenant = (tenant: string): PayloadRequest =>
		Object.assign(Object.create(fixture.req), {
			headers: new Headers({ cookie: `payload-tenant=${tenant}` }),
		}) as PayloadRequest
	const list = (req: PayloadRequest = fixture.req, collection: string | null = null) =>
		readMerges({ req, ctx: ctx(), collection, page: 1, limit: 25 })

	beforeAll(async () => {
		fixture = await bootDedupe(db)
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	it('lists a group merge once, with the absorbed documents named from the trash and who applied it', async () => {
		const group = [
			await fixture.customer({ name: 'Olena Kravets', email: 'olena@history.test' }),
			await fixture.customer({ name: 'Olena Kravec', email: 'olena.k@history.test' }),
			await fixture.customer({ name: 'O. Kravets', email: 'kravets@history.test' }),
		]
		const { mergeId } = await merge(CUSTOMERS, group)

		const item = (await list()).docs.find((entry) => entry.id === mergeId)
		expect(item).toMatchObject({
			collection: 'customers',
			survivor: { id: String(group[0]?.id), title: 'Olena Kravets', state: 'live' },
			absorbed: [
				{ id: String(group[1]?.id), title: 'Olena Kravec', state: 'trash' },
				{ id: String(group[2]?.id), title: 'O. Kravets', state: 'trash' },
			],
			appliedBy: 'reviewer@example.com',
			status: 'applied',
		})
	})

	it('lists newest first and only the collection asked for', async () => {
		const [a, b] = [
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'first@history.test' } as never,
			}),
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'first.dup@history.test' } as never,
			}),
		]
		const { mergeId } = await merge(LEADS, [a, b] as Doc[])

		const leads = await list(fixture.req, 'leads')
		expect(leads.docs.map((entry) => entry.collection)).toEqual(['leads'])
		expect((await list()).docs[0]?.id).toBe(mergeId)
	})

	it('keeps the merges of another tenant than the one selected out of the list and the record', async () => {
		const pair = [
			await fixture.customer({ name: 'Taras North', email: 'taras@north.test', tenant: 'north' }),
			await fixture.customer({ name: 'Taras N.', email: 'taras.n@north.test', tenant: 'north' }),
		]
		const { mergeId } = await merge(CUSTOMERS, pair)

		const ids = async (tenant: string) =>
			(await list(withTenant(tenant))).docs.map((entry) => entry.id)
		expect(await ids('north')).toContain(mergeId)
		expect(await ids('south')).not.toContain(mergeId)
		await expect(
			readMergeRecord({ req: withTenant('south'), ctx: ctx(), id: mergeId })
		).rejects.toMatchObject({ status: 404 })
	})

	it('lists and opens the merges of a collection without a tenant field whichever tenant is selected', async () => {
		const pair = [
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'shared.one@history.test' } as never,
			}),
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'shared.two@history.test' } as never,
			}),
		] as Doc[]
		const { mergeId } = await merge(LEADS, pair)
		expect((await list(withTenant('north'), 'leads')).docs.map((entry) => entry.id)).toContain(
			mergeId
		)
		await expect(
			readMergeRecord({ req: withTenant('north'), ctx: ctx(), id: mergeId })
		).resolves.toMatchObject({ collection: 'leads' })
	})

	it('opens a record that names references in a collection the app no longer has', async () => {
		const pair = [
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'removed.one@history.test' } as never,
			}),
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'removed.two@history.test' } as never,
			}),
		] as Doc[]
		const { mergeId } = await merge(LEADS, pair)
		await fixture.booted.payload.db.updateOne({
			collection: MERGES_SLUG,
			id: mergeId,
			data: {
				repointed: [
					{ collection: 'removed', path: 'owner', from: String(pair[1]?.id), ids: ['7'] },
					{
						collection: 'removed-global',
						global: true,
						path: 'owner',
						from: String(pair[1]?.id),
						ids: ['removed-global'],
					},
				],
			},
		})
		const record = await readMergeRecord({ req: fixture.req, ctx: ctx(), id: mergeId })
		expect(record.moved.map((entry) => [entry.collectionLabel, entry.docs])).toEqual([
			['removed', [{ id: '7', title: '7' }]],
			['removed-global', [{ id: 'removed-global', title: 'removed-global' }]],
		])
	})

	it('keeps in its copy of a merged-in document the fields hidden from the API', async () => {
		const create = (data: Record<string, unknown>) =>
			fixture.booted.payload.create({ collection: TICKETS, data: data as never }) as Promise<Doc>
		const keep = await create({ title: 'Hidden copy' })
		const gone = await create({ title: 'Hidden copy', externalRef: 'crm-42' })
		const { mergeId } = await merge(TICKETS, [keep, gone])
		const record = (await fixture.booted.payload.db.findOne({
			collection: MERGES_SLUG,
			where: { id: { equals: mergeId } },
		})) as unknown as { absorbedSnapshots: Record<string, Record<string, unknown>> }
		expect(record.absorbedSnapshots[String(gone.id)]?.externalRef).toBe('crm-42')
	})

	it('shows every field as it was on each document and as the merge left it', async () => {
		const group = [
			await fixture.customer({ name: 'Iryna Tkachenko', email: 'iryna@history.test' }),
			await fixture.customer({
				name: 'Iryna Tkachenko',
				email: 'iryna.t@history.test',
				phone: '0501234567',
			}),
		]
		const [survivor, absorbed] = group.map((doc) => String(doc.id)) as [string, string]
		const { mergeId } = await merge(CUSTOMERS, group, { email: { doc: absorbed } })

		const record = await readMergeRecord({ req: fixture.req, ctx: ctx(), id: mergeId })
		expect(record.survivor).toMatchObject({ id: survivor, state: 'live' })
		expect(record.absorbed).toMatchObject([{ id: absorbed, state: 'trash' }])
		expect(record.decisions.find((decision) => decision.key === 'email')).toMatchObject({
			label: 'Email',
			values: [
				{ doc: survivor, value: 'iryna@history.test' },
				{ doc: absorbed, value: 'iryna.t@history.test' },
			],
			proposed: 'iryna.t@history.test',
		})
		expect(record.decisions.find((decision) => decision.key === 'phone')).toMatchObject({
			proposed: '0501234567',
			auto: true,
		})
		const row = (await fixture.booted.payload.db.findOne({
			collection: MERGES_SLUG,
			where: { id: { equals: mergeId } },
			req: fixture.req,
		})) as { released?: Record<string, { marked: string[] }> } | null
		expect(row?.released?.[absorbed]?.marked).toEqual(['email'])
	})

	it('names the documents it moved to the survivor', async () => {
		const pair = [
			await fixture.customer({ name: 'Petro Shevchuk', email: 'petro@history.test' }),
			await fixture.customer({ name: 'Petro Shevchuk', email: 'petro.s@history.test' }),
		]
		await fixture.booted.payload.create({
			collection: ORDERS,
			data: { number: 'H-1', customer: pair[1]?.id } as never,
		})
		const { mergeId } = await merge(CUSTOMERS, pair)

		const record = await readMergeRecord({ req: fixture.req, ctx: ctx(), id: mergeId })
		expect(record.moved).toMatchObject([
			{
				collection: 'orders',
				path: 'customer',
				from: String(pair[1]?.id),
				total: 1,
				docs: [{ title: 'H-1' }],
			},
		])
	})

	it('marks an absorbed document the merge deleted, and names it from the record', async () => {
		const pair = [
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'gone@history.test' } as never,
			}),
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'gone.dup@history.test' } as never,
			}),
		] as Doc[]
		const { mergeId } = await merge(LEADS, pair)

		const record = await readMergeRecord({ req: fixture.req, ctx: ctx(), id: mergeId })
		expect(record.absorbed).toEqual([
			{ id: String(pair[1]?.id), title: 'gone.dup@history.test', state: 'deleted' },
		])
	})

	it('refuses the record to a reader who may not read the collection, and lists it by ids alone', async () => {
		const pair = [
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'secret@history.test' } as never,
			}),
			await fixture.booted.payload.create({
				collection: LEADS,
				data: { email: 'secret.dup@history.test' } as never,
			}),
		] as Doc[]
		const { mergeId } = await merge(LEADS, pair)
		const limited = await reqFor(fixture.booted, 'limited-history@example.com')

		await expect(readMergeRecord({ req: limited, ctx: ctx(), id: mergeId })).rejects.toMatchObject({
			status: 403,
		})
		const item = (await list(limited)).docs.find((entry) => entry.id === mergeId)
		expect(item).toMatchObject({
			readable: false,
			appliedBy: null,
			survivor: { title: String(pair[0]?.id) },
			absorbed: [{ title: String(pair[1]?.id) }],
		})
	})
})
