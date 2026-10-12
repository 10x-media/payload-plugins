import { describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { applyMerge } from '../../src/merge/apply'
import { buildPlanResponse } from '../../src/merge/planResponse'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import type { MergeChoice } from '../../src/schema/types'
import { bootDedupe, CARDS, type Doc, pluginOptions } from './fixtures'

type Card = Doc & {
	phone?: { country?: string; number?: string }
	labels?: { text: string }[]
}

/** Fields drawn by components of their own: searched by what is inside, merged whole. */
describeForDb('dedupe fields with components of their own', {}, (db) => {
	let fixture: Awaited<ReturnType<typeof bootDedupe>>
	let n = 0

	beforeAll(async () => {
		fixture = await bootDedupe(db, {
			collections: {
				...pluginOptions.collections,
				cards: {
					match: {
						fields: [
							{ path: 'name', weight: 40, compare: 'text' },
							{ path: 'phone.number', weight: 40, compare: 'phone' },
						],
					},
				},
			},
		})
	})

	afterAll(async () => {
		await fixture.booted.stop()
	})

	const card = (data: Partial<Card>) =>
		fixture.booted.payload.create({ collection: CARDS, data: data as never }) as Promise<Card>
	const args = ([keep, gone]: [Card, Card], choices: Record<string, MergeChoice> = {}) => ({
		req: fixture.req,
		ctx: getContext(fixture.booted.payload),
		col: getCollectionContext(fixture.booted.payload, CARDS),
		survivorId: keep.id,
		absorbedIds: [gone.id],
		choices,
	})
	const stored = async (id: number | string) =>
		(await fixture.booted.payload.findByID({ collection: CARDS, id, depth: 0 })) as Card

	const twins = async () => {
		n++
		return [
			await card({
				name: `Card ${n}`,
				phone: { country: '+49', number: `30 111 ${n}` },
				labels: [{ text: 'Partner' }],
				color: '#ff8800',
			}),
			await card({
				name: `Card ${n}`,
				phone: { country: '+380', number: `30 111 ${n}` },
				labels: [{ text: 'Partner' }, { text: 'Late payer' }],
				color: '#ff7700',
			}),
		] as [Card, Card]
	}

	it('searches by a field inside a group merged whole', async () => {
		const [keep, gone] = await twins()
		const pairs = await fixture.pairsFor(gone.id)
		expect(pairs.map((pair) => [pair.docA, pair.docB].sort())).toContainEqual(
			[String(keep.id), String(gone.id)].sort()
		)
	})

	it('plans such a group and list as one value each, marked to be drawn by their components', async () => {
		const plan = await buildPlanResponse(args(await twins()))
		const keys = plan.decisions.map((decision) => decision.key)
		expect(keys).toEqual(expect.arrayContaining(['phone', 'labels', 'color']))
		expect(keys).not.toContain('phone.country')
		const by = (key: string) => plan.decisions.find((decision) => decision.key === key)
		expect(by('phone')).toMatchObject({ component: true, list: false, conflict: true })
		expect(by('labels')).toMatchObject({ component: true, list: false })
		expect(by('color')).toMatchObject({ component: true })
		expect(by('name')).toMatchObject({ component: false })
	})

	it('takes a whole group and a whole list from the document picked', async () => {
		const [keep, gone] = await twins()
		await applyMerge(
			args([keep, gone], { phone: { doc: String(gone.id) }, labels: { doc: String(gone.id) } })
		)
		const merged = await stored(keep.id)
		expect(merged.phone).toMatchObject({ country: '+380', number: gone.phone?.number })
		expect(merged.labels?.map((row) => row.text)).toEqual(['Partner', 'Late payer'])
	})

	it('ignores a pick of rows of a list merged whole', async () => {
		const [keep, gone] = await twins()
		await applyMerge(
			args([keep, gone], { labels: { items: [{ doc: String(gone.id), index: 1 }] } })
		)
		expect((await stored(keep.id)).labels?.map((row) => row.text)).toEqual(['Partner'])
	})
})
