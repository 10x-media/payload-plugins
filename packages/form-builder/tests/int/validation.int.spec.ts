import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder validation', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('rejects a submission violating a declarative minLength rule', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Codes',
				fields: [
					{
						blockType: 'text',
						name: 'code',
						label: 'Code',
						validations: [{ blockType: 'minLength', min: 4 }],
					},
				],
			},
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'code', value: 'ab' }] },
			})
		).rejects.toThrow()
	})

	it('accepts a submission satisfying the rule', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Codes',
				fields: [
					{
						blockType: 'text',
						name: 'code',
						label: 'Code',
						validations: [{ blockType: 'minLength', min: 4 }],
					},
				],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: form.id, values: [{ field: 'code', value: 'abcd' }] },
		})
		expect(submission.values).toEqual([{ field: 'code', value: 'abcd' }])
	})

	it('enforces a server-only notAlreadySubmitted rule across submissions', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Signups',
				fields: [
					{
						blockType: 'email',
						name: 'email',
						label: 'Email',
						required: true,
						validations: [{ blockType: 'notAlreadySubmitted' }],
					},
				],
			},
		})
		await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'email', value: 'a@b.com' }] },
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'email', value: 'a@b.com' }] },
			})
		).rejects.toThrow()
	})
})
