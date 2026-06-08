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

	it('registers the form-submissions collection', () => {
		expect(booted.payload.collections['form-submissions']).toBeDefined()
	})

	it('stores a form with a fields blocks array', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [
					{ blockType: 'text', name: 'fullName', label: 'Full name', required: true },
					{ blockType: 'email', name: 'email', label: 'Email', required: true },
				],
			},
		})
		expect(Array.isArray(form.fields)).toBe(true)
		expect(form.fields).toHaveLength(2)
	})

	it('creates a submission linked to a form', async () => {
		const form = await booted.payload.create({ collection: 'forms', data: { title: 'Contact' } })
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				status: 'complete',
				locale: 'en',
				values: [{ field: 'email', value: 'a@b.com' }],
				descriptors: [{ field: 'email', label: 'Email', type: 'email' }],
			},
		})
		expect(submission.form).toBe(form.id)
		expect(submission.status).toBe('complete')
	})
})
