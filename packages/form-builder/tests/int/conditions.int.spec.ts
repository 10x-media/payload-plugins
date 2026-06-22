import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder conditions', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const buildForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Conditional',
				fields: [
					{ blockType: 'text', name: 'plan', label: 'Plan' },
					{
						blockType: 'text',
						name: 'detail',
						label: 'Detail',
						required: true,
						visibleWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
					},
				],
			},
		})

	it('does not enforce a hidden required field and does not store it', async () => {
		const form = await buildForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: form.id, values: [{ field: 'plan', value: 'free' }] },
		})
		expect(submission.values).toEqual([{ field: 'plan', value: 'free' }])
	})

	it('enforces a visible required field', async () => {
		const form = await buildForm()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'plan', value: 'pro' }] },
			})
		).rejects.toThrow()
	})

	it('ignores a client-sent value for a hidden field', async () => {
		const form = await buildForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [
					{ field: 'plan', value: 'free' },
					{ field: 'detail', value: 'sneaky' },
				],
			},
		})
		expect(submission.values).toEqual([{ field: 'plan', value: 'free' }])
	})
})
