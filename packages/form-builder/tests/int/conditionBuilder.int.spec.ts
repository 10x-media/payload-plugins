import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder condition normalization', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('canonicalizes a shorthand visibleWhen to OR-of-ANDs on create', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Normalize Shorthand',
				fields: [
					{ blockType: 'text', name: 'plan', label: 'Plan' },
					{
						blockType: 'text',
						name: 'detail',
						label: 'Detail',
						visibleWhen: { plan: { equals: 'pro' } },
					},
				],
			},
		})
		const detail = form.fields?.find((f: Record<string, unknown>) => f.name === 'detail') as
			| Record<string, unknown>
			| undefined
		expect(detail?.visibleWhen).toEqual({ or: [{ and: [{ plan: { equals: 'pro' } }] }] })
	})

	it('drops a visibleWhen referencing a field not in the form', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Drop Unknown Ref',
				fields: [
					{
						blockType: 'text',
						name: 'firstName',
						label: 'First Name',
						visibleWhen: { or: [{ and: [{ ghost: { equals: 'x' } }] }] },
					},
				],
			},
		})
		const field = form.fields?.[0] as Record<string, unknown> | undefined
		expect(field?.visibleWhen == null).toBe(true)
	})
})
