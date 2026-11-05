import { describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { moveMemberships, validateMemberships } from '../../dev/helpers/memberships'
import { applyMerge } from '../../src/merge/apply'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { bootDedupe, COMPANIES, CUSTOMERS, type Doc, pluginOptions } from './fixtures'

const MEMBERSHIPS = 'memberships' as CollectionSlug

/** The host's merge sections: their values reach `beforeRemove`, and `validate` can refuse. */
describeForDb('dedupe merge sections', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let handed: Record<string, unknown> | null = null
	let n = 0

	beforeAll(async () => {
		const customers = pluginOptions.collections?.customers
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				customers: {
					...(typeof customers === 'object' ? customers : {}),
					sections: [
						{
							key: 'memberships',
							Component: '/components/MembershipsSection#MembershipsSection',
							validate: validateMemberships,
						},
						{
							key: 'note',
							Component: '/components/Note#Note',
							validate: ({ value }) => (value === 'refuse' ? 'The note says no.' : null),
						},
					],
				},
			},
			hooks: {
				beforeRemove: async (args) => {
					handed = args.sections
					if (args.collection === CUSTOMERS) await moveMemberships(args)
				},
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	const twins = async () => {
		n++
		const data = { name: `Section Twin${n}`, phone: `04477${n}1122` }
		return [
			await fixture.customer({ ...data, email: `section.a${n}@sections.test` }),
			await fixture.customer({ ...data, email: `section.b${n}@sections.test` }),
		] as [Doc, Doc]
	}
	const merge = (survivor: Doc, absorbed: Doc[], sections?: Record<string, unknown>) =>
		applyMerge({
			req: fixture.req,
			ctx: getContext(fixture.booted.payload),
			col: getCollectionContext(fixture.booted.payload, CUSTOMERS),
			survivorId: survivor.id,
			absorbedIds: absorbed.map((doc) => doc.id),
			choices: {},
			...(sections ? { sections } : {}),
		})
	const club = async (name: string) =>
		(await fixture.booted.payload.create({
			collection: COMPANIES,
			data: { name } as never,
		})) as Doc
	const membership = async (customer: Doc, at: Doc) =>
		(await fixture.booted.payload.create({
			collection: MEMBERSHIPS,
			data: {
				title: `${customer.email} in ${at.name}`,
				customer: customer.id,
				club: at.id,
			} as never,
		})) as Doc
	const membershipsOf = async (customer: Doc) =>
		(
			await fixture.booted.payload.find({
				collection: MEMBERSHIPS,
				where: { customer: { equals: customer.id } },
				depth: 0,
				pagination: false,
			})
		).docs as Doc[]

	it('hands each section its value by key, null for one that set none, and drops the rest', async () => {
		const [keep, gone] = await twins()
		await merge(keep, [gone], { note: 'kept', stray: 'dropped' })
		expect(handed).toEqual({ memberships: null, note: 'kept' })
	})

	it("refuses the merge with the section's answer before writing anything", async () => {
		const [keep, gone] = await twins()
		handed = null
		await expect(merge(keep, [gone], { note: 'refuse' })).rejects.toMatchObject({
			message: 'The note says no.',
			status: 409,
		})
		expect(handed).toBeNull()
		const still = (await fixture.booted.payload.findByID({
			collection: CUSTOMERS,
			id: gone.id,
			depth: 0,
		})) as Doc
		expect(still.deletedAt ?? null).toBeNull()
	})

	it("keeps the membership the reviewer picked in a club both customers are in, as the dev app's section does", async () => {
		const [keep, gone] = await twins()
		const shared = await club(`Shared club ${n}`)
		const own = await club(`Own club ${n}`)
		await membership(keep, shared)
		const picked = await membership(gone, shared)
		const moved = await membership(gone, own)

		await expect(merge(keep, [gone])).rejects.toMatchObject({ status: 409 })

		await merge(keep, [gone], { memberships: { [String(shared.id)]: String(picked.id) } })
		const held = (await membershipsOf(keep)).map((doc) => String(doc.id)).sort()
		expect(held).toEqual([String(picked.id), String(moved.id)].sort())
	})
})
