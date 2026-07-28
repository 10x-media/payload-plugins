import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { defineCalcFunction, defineCalcSource, formBuilder } from '../../src/index'

const NET_EXPRESSION = { type: 'weight', field: 'product', source: 'productPrices' }
const GROSS_EXPRESSION = {
	type: 'op',
	op: '*',
	left: { type: 'ref', field: 'net' },
	right: {
		type: 'op',
		op: '+',
		left: { type: 'lit', value: 1 },
		right: { type: 'source', source: 'taxRate' },
	},
}
const DOUBLED_EXPRESSION = {
	type: 'fn',
	fn: 'double',
	args: [{ type: 'ref', field: 'net' }],
}

describeForDb('form-builder calc sources', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const resolveTaxRate = vi.fn().mockResolvedValue(0.5)
	const resolveProductPrices = vi.fn().mockResolvedValue({ small: 10, large: 24 })

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				calc: {
					sources: {
						taxRate: defineCalcSource({ label: 'Tax rate', resolve: resolveTaxRate }),
						productPrices: defineCalcSource({
							label: 'Product prices',
							resolveWeights: resolveProductPrices,
						}),
						broken: defineCalcSource({
							label: 'Broken',
							resolve: () => {
								throw new Error('pricing backend down')
							},
						}),
					},
					functions: {
						double: defineCalcFunction({ label: 'Double', apply: (args) => (args[0] ?? 0) * 2 }),
					},
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeSourcedForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Quote',
				fields: [
					{
						blockType: 'select',
						name: 'product',
						label: 'Product',
						options: [
							{ label: 'Small', value: 'small' },
							{ label: 'Large', value: 'large' },
						],
					},
					{ blockType: 'calculation', name: 'net', expression: NET_EXPRESSION },
					{ blockType: 'calculation', name: 'gross', expression: GROSS_EXPRESSION },
					{ blockType: 'calculation', name: 'doubled', expression: DOUBLED_EXPRESSION },
				],
			},
		})

	it('accepts source-using expressions through the threaded allowed sets', async () => {
		const form = await makeSourcedForm()
		const fields = form.fields as { name?: string; expression?: unknown }[]
		expect(fields.find((f) => f.name === 'net')?.expression).toEqual(NET_EXPRESSION)
		expect(fields.find((f) => f.name === 'gross')?.expression).toEqual(GROSS_EXPRESSION)
		expect(fields.find((f) => f.name === 'doubled')?.expression).toEqual(DOUBLED_EXPRESSION)
	})

	it('still drops expressions referencing unregistered keys', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Unregistered',
				fields: [
					{
						blockType: 'calculation',
						name: 'bad',
						expression: { type: 'source', source: 'unknown' },
					},
				],
			},
		})
		const fields = form.fields as { name?: string; expression?: unknown }[]
		expect(fields.find((f) => f.name === 'bad')?.expression).toBeUndefined()
	})

	it('embeds calcResolved on form reads', async () => {
		const form = await makeSourcedForm()
		const read = await booted.payload.findByID({ collection: 'forms', id: form.id })
		expect((read as { calcResolved?: unknown }).calcResolved).toEqual({
			sources: { taxRate: 0.5 },
			weights: { 'productPrices product': { small: 10, large: 24 } },
		})
	})

	it('does not stamp calcResolved on forms without source usage', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Plain',
				fields: [
					{ blockType: 'number', name: 'a' },
					{
						blockType: 'calculation',
						name: 'total',
						expression: { type: 'ref', field: 'a' },
					},
				],
			},
		})
		const read = await booted.payload.findByID({ collection: 'forms', id: form.id })
		expect((read as { calcResolved?: unknown }).calcResolved).toBeUndefined()
	})

	it('computes submissions with resolved sources, weights, and custom functions, ignoring client-sent calc values', async () => {
		const form = await makeSourcedForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: {
				form: form.id,
				values: [
					{ field: 'product', value: 'large' },
					{ field: 'net', value: 999 },
					{ field: 'gross', value: 999 },
				],
			},
		})
		const values = submission.values as { field: string; value: unknown }[]
		expect(values.find((entry) => entry.field === 'net')?.value).toBe(24)
		expect(values.find((entry) => entry.field === 'gross')?.value).toBe(36)
		expect(values.find((entry) => entry.field === 'doubled')?.value).toBe(48)
	})

	it('rejects a submission when a used resolver throws, but form reads still succeed', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Broken pricing',
				fields: [
					{
						blockType: 'calculation',
						name: 'rate',
						expression: { type: 'source', source: 'broken' },
					},
				],
			},
		})
		const read = await booted.payload.findByID({ collection: 'forms', id: form.id })
		expect(read.id).toBe(form.id)
		expect((read as { calcResolved?: unknown }).calcResolved).toBeUndefined()
		// The outage surfaces as a translated 503, never a generic 500 leaking the resolver error.
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [] },
			})
		).rejects.toMatchObject({ status: 503 })
	})
})
