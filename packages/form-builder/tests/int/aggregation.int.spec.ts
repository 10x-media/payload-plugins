import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	aggregateFieldResponses,
	aggregateFormResponses,
} from '../../src/aggregation/aggregateResponses'
import { formBuilder } from '../../src/index'

describeForDb('form-builder response aggregation', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makePollForm = async () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Colour poll',
				fields: [
					{
						blockType: 'select',
						name: 'colour',
						label: 'Favourite colour',
						options: [
							{ label: 'Red', value: 'red' },
							{ label: 'Blue', value: 'blue' },
							{ label: 'Green', value: 'green' },
						],
					},
				],
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'colour', value }] },
		})

	it('aggregates counts, percentages, labels, and option order', async () => {
		const form = await makePollForm()
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')

		const agg = await aggregateFieldResponses({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
		})

		expect(agg).not.toBeNull()
		expect(agg?.total).toBe(3)
		expect(agg?.label).toBe('Favourite colour')
		expect(agg?.buckets.map((b) => [b.value, b.count, b.percentage])).toEqual([
			['red', 2, 66.7],
			['blue', 1, 33.3],
			['green', 0, 0],
		])
	})

	it('aggregates every enumerable field by default in one pass', async () => {
		const form = await makePollForm()
		await vote(form.id, 'green')
		const results = await aggregateFormResponses({ payload: booted.payload, formId: form.id })
		expect(results).toHaveLength(1)
		expect(results[0]?.field).toBe('colour')
		expect(results[0]?.buckets.find((b) => b.value === 'green')?.count).toBe(1)
	})

	it('counts only complete submissions by default', async () => {
		const form = await makePollForm()
		await vote(form.id, 'red')
		await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: form.id, status: 'partial', values: [{ field: 'colour', value: 'blue' }] },
		})
		const completeOnly = await aggregateFieldResponses({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
		})
		expect(completeOnly?.total).toBe(1)
		const all = await aggregateFieldResponses({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			status: 'all',
		})
		expect(all?.total).toBe(2)
	})

	it('flags truncated only when matching rows are left out, not at the exact cap', async () => {
		const form = await makePollForm()
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await vote(form.id, 'green')

		const exact = await aggregateFieldResponses({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			maxSubmissions: 3,
			pageSize: 2,
		})
		expect(exact?.total).toBe(3)
		expect(exact?.truncated).toBe(false)

		const capped = await aggregateFieldResponses({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			maxSubmissions: 2,
			pageSize: 2,
		})
		expect(capped?.total).toBe(2)
		expect(capped?.truncated).toBe(true)
	})

	it('returns null for an unknown field and [] for a form with no enumerable fields', async () => {
		const form = await makePollForm()
		expect(
			await aggregateFieldResponses({ payload: booted.payload, formId: form.id, field: 'nope' })
		).toBeNull()
		const textForm = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Text', fields: [{ blockType: 'text', name: 'msg', label: 'Message' }] },
		})
		expect(await aggregateFormResponses({ payload: booted.payload, formId: textForm.id })).toEqual(
			[]
		)
	})
})
