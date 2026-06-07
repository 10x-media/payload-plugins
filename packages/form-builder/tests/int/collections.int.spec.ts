import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder collections', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the forms collection', () => {
		expect(booted.payload.collections.forms).toBeDefined()
	})

	it('creates a form with a title', async () => {
		const form = await booted.payload.create({ collection: 'forms', data: { title: 'Contact' } })
		expect(form.title).toBe('Contact')
	})
})
