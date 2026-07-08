import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder repeater', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('rejects a zero-row submission when minRows is set', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Members',
				fields: [
					{
						blockType: 'repeater',
						name: 'members',
						label: 'Members',
						minRows: 2,
						subFields: [],
					},
				],
			},
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [] },
			})
		).rejects.toThrow()
	})

	it('accepts a submission that meets minRows', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Members2',
				fields: [
					{
						blockType: 'repeater',
						name: 'members',
						label: 'Members',
						minRows: 1,
						subFields: [],
					},
				],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [{ field: 'members', value: [{}] }],
			},
		})
		expect(submission.values).toEqual([{ field: 'members', value: [{}] }])
	})

	it('accepts a zero-row submission when minRows is 0 (or unset)', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Optional repeater',
				fields: [
					{
						blockType: 'repeater',
						name: 'extras',
						label: 'Extras',
						subFields: [],
					},
				],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: form.id, values: [] },
		})
		expect(submission).toBeDefined()
	})

	it('rejects a submission that exceeds maxRows', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Capped list',
				fields: [
					{
						blockType: 'repeater',
						name: 'items',
						label: 'Items',
						maxRows: 2,
						subFields: [],
					},
				],
			},
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: {
					form: form.id,
					values: [{ field: 'items', value: [{}, {}, {}] }],
				},
			})
		).rejects.toThrow()
	})
})
