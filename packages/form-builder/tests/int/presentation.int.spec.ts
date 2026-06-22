import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder defaultPresentation', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('defaults to page when not set', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'No presentation',
				fields: [],
			},
		})

		expect(form.defaultPresentation).toBe('page')
	})

	it('clamps unknown value to page', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Unknown presentation',
				fields: [],
				defaultPresentation: 'nope',
			},
		})

		expect(form.defaultPresentation).toBe('page')
	})

	it('preserves a valid known presentation', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Modal presentation',
				fields: [],
				defaultPresentation: 'modal',
			},
		})

		expect(form.defaultPresentation).toBe('modal')
	})
})
