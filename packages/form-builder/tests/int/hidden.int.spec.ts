import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder hidden fields', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores hidden: true at the top level on a field instance (unnamed collapsible does not nest)', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Hidden field test',
				fields: [
					{
						blockType: 'text',
						name: 'utm_source',
						label: 'UTM Source',
						hidden: true,
					},
					{
						blockType: 'text',
						name: 'email',
						label: 'Email',
					},
				],
			},
		})

		const utmField = form.fields?.find((f: Record<string, unknown>) => f.name === 'utm_source')
		expect(utmField?.hidden).toBe(true)

		const emailField = form.fields?.find((f: Record<string, unknown>) => f.name === 'email')
		expect(emailField?.hidden).toBeFalsy()
	})
})
