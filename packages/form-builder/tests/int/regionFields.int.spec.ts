import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { countryField } from '../../src/fields/builtin/country'
import { stateField } from '../../src/fields/builtin/state'
import { formBuilder } from '../../src/index'
import type { SubmissionDescriptor, SubmissionValue } from '../../src/submissions/types'

const t = (key: string) => key

describeForDb('form-builder country/state fields', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Address',
				fields: [
					{ blockType: 'country', name: 'country', label: 'Country', required: true },
					{ blockType: 'state', name: 'state', label: 'State' },
				],
			},
		})

	it('round-trips valid country/state codes and resolves their names', async () => {
		const form = await makeForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: {
				form: form.id,
				values: [
					{ field: 'country', value: 'DE' },
					{ field: 'state', value: 'CA' },
				],
			},
		})

		const values = submission.values as SubmissionValue[]
		expect(values).toContainEqual({ field: 'country', value: 'DE' })
		expect(values).toContainEqual({ field: 'state', value: 'CA' })

		const descriptors = submission.descriptors as SubmissionDescriptor[]
		const countryDescriptor = descriptors.find((entry) => entry.field === 'country')
		const stateDescriptor = descriptors.find((entry) => entry.field === 'state')
		expect(countryDescriptor?.label).toBe('Country')
		expect(stateDescriptor?.label).toBe('State')

		expect(countryField.format?.({ value: 'DE', config: {}, locale: 'en', t })).toBe('Germany')
		expect(stateField.format?.({ value: 'CA', config: {}, locale: 'en', t })).toBe('California')
	})

	it('rejects an unknown country code', async () => {
		const form = await makeForm()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'country', value: 'ZZ' }] },
			})
		).rejects.toThrow()
	})

	it('rejects an unknown state code', async () => {
		const form = await makeForm()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: {
					form: form.id,
					values: [
						{ field: 'country', value: 'US' },
						{ field: 'state', value: 'ZZ' },
					],
				},
			})
		).rejects.toThrow()
	})
})
