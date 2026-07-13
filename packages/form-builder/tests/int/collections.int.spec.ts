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

	it('stores typed values and localized descriptors on submit', async () => {
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
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [
					{ field: 'fullName', value: 'Ada' },
					{ field: 'email', value: 'ada@x.com' },
				],
			},
		})
		expect(submission.form).toBe(form.id)
		expect(submission.status).toBe('complete')
		expect(submission.locale).toBe('en')
		expect(submission.values).toEqual([
			{ field: 'fullName', value: 'Ada' },
			{ field: 'email', value: 'ada@x.com' },
		])
		expect(submission.descriptors).toEqual([
			{ field: 'fullName', label: 'Full name', fieldType: 'text' },
			{ field: 'email', label: 'Email', fieldType: 'email' },
		])
	})

	it('rejects an invalid submission server-side', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'email', name: 'email', label: 'Email', required: true }],
			},
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'email', value: 'not-an-email' }] },
			})
		).rejects.toThrow()
	})

	it('stores a form with a date field block', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'date', name: 'startDate', label: 'Start date', required: true }],
			},
		})
		expect(Array.isArray(form.fields)).toBe(true)
		expect(form.fields).toHaveLength(1)
		expect((form.fields as { blockType: string }[])[0]?.blockType).toBe('date')
	})

	it('rejects a submission missing a required field', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'text', name: 'fullName', label: 'Full name', required: true }],
			},
		})
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [] },
			})
		).rejects.toThrow()
	})
})
