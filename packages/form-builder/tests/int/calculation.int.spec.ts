import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

const VALID_EXPRESSION = {
	type: 'op',
	op: '+',
	left: { type: 'ref', field: 'a' },
	right: { type: 'ref', field: 'b' },
}

describeForDb('form-builder calculation field', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('round-trips a valid expression unchanged', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Calc valid',
				fields: [
					{
						blockType: 'calculation',
						name: 'total',
						expression: VALID_EXPRESSION,
					},
				],
			},
		})

		const field = (form.fields as { blockType: string; expression?: unknown }[]).find(
			(f) => f.blockType === 'calculation'
		)
		expect(field?.expression).toEqual(VALID_EXPRESSION)
	})

	it('drops a malformed expression to undefined', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Calc malformed',
				fields: [
					{
						blockType: 'calculation',
						name: 'bad',
						expression: { type: 'bogus' },
					},
				],
			},
		})

		const field = (form.fields as { blockType: string; expression?: unknown }[]).find(
			(f) => f.blockType === 'calculation'
		)
		expect(field?.expression).toBeUndefined()
	})
})
