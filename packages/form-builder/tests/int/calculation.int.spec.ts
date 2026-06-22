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

	it('stores the server-computed calc value, ignoring any client-sent value', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Calc trust boundary',
				fields: [
					{ blockType: 'number', name: 'a' },
					{
						blockType: 'calculation',
						name: 'total',
						expression: {
							type: 'op',
							op: '*',
							left: { type: 'ref', field: 'a' },
							right: { type: 'lit', value: 2 },
						},
					},
				],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'a', value: 21 },
					{ field: 'total', value: 999 },
				],
			},
		})

		const values = submission.values as { field: string; value: unknown }[]
		const total = values.find((entry) => entry.field === 'total')
		expect(total?.value).toBe(42)
		expect(total?.value).not.toBe(999)
	})

	it('gates conditions on the computed calc value, not the client-sent one', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Calc gates condition',
				fields: [
					{ blockType: 'number', name: 'a' },
					{
						blockType: 'calculation',
						name: 'score',
						expression: { type: 'ref', field: 'a' },
					},
					{ blockType: 'text', name: 'bonus', visibleWhen: { score: { equals: 5 } } },
				],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'a', value: 5 },
					{ field: 'score', value: 999 },
					{ field: 'bonus', value: 'shown' },
				],
			},
		})

		const values = submission.values as { field: string; value: unknown }[]
		// score computes to 5 (a), so bonus's `score equals 5` gate passes on the COMPUTED value; the bogus client score (999) would have hidden it.
		expect(values.find((entry) => entry.field === 'score')?.value).toBe(5)
		expect(values.find((entry) => entry.field === 'bonus')?.value).toBe('shown')
	})
})
