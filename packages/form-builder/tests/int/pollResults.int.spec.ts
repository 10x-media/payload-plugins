import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder poll results gating', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = async (over: Record<string, unknown>) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Poll',
				fields: [
					{
						blockType: 'select',
						name: 'colour',
						label: 'Colour',
						options: [
							{ label: 'Red', value: 'red' },
							{ label: 'Blue', value: 'blue' },
						],
					},
					{ blockType: 'text', name: 'note', label: 'Note' },
				],
				...over,
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'colour', value }] },
		})

	it('serves public results for an opted-in form (anonymous)', async () => {
		const form = await makeForm({ showResults: true, resultsField: 'colour' })
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			isAuthed: false,
		})
		expect(res.status).toBe(200)
		expect('results' in res.body && res.body.results[0]?.total).toBe(2)
	})

	it('forbids anonymous results when the form did not opt in', async () => {
		const form = await makeForm({})
		await vote(form.id, 'red')
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			isAuthed: false,
		})
		expect(res.status).toBe(403)
	})

	it('forbids an anonymous request for a field other than the public one', async () => {
		const form = await makeForm({ showResults: true, resultsField: 'colour' })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'note',
			isAuthed: false,
		})
		expect(res.status).toBe(403)
	})

	it('forbids anonymous results when the public field is not enumerable (PII guard)', async () => {
		const form = await makeForm({ showResults: true, resultsField: 'note' })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(res.status).toBe(403)
	})

	it('allows an authed caller to aggregate any field', async () => {
		const form = await makeForm({})
		await vote(form.id, 'red')
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'colour',
			isAuthed: true,
		})
		expect(res.status).toBe(200)
		expect('results' in res.body && res.body.results[0]?.total).toBe(1)
	})

	it('404s an unknown form', async () => {
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: 999999,
			isAuthed: true,
		})
		expect(res.status).toBe(404)
	})
})
