import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { defineCalcSource } from './registry'
import { calcUsesSources, resolveCalcContext } from './resolveCalcContext'
import type { CalcExpression } from './types'

const payload = {} as Payload
const form = { id: 1 }

const calcField = (name: string, expression: CalcExpression): FormFieldInstance => ({
	blockType: 'calculation',
	name,
	expression,
})

const sourceExpr = (key: string): CalcExpression => ({ type: 'source', source: key })
const weightExpr = (field: string, key: string): CalcExpression => ({
	type: 'weight',
	field,
	source: key,
})

describe('calcUsesSources', () => {
	it('is false for forms without source-using expressions', () => {
		expect(calcUsesSources([])).toBe(false)
		expect(calcUsesSources([calcField('total', { type: 'ref', field: 'a' })])).toBe(false)
		expect(
			calcUsesSources([calcField('total', { type: 'weight', field: 'size', weights: { S: 1 } })])
		).toBe(false)
	})

	it('is true for scalar source nodes and sourced weight nodes, nested included', () => {
		expect(calcUsesSources([calcField('tax', sourceExpr('taxRate'))])).toBe(true)
		expect(calcUsesSources([calcField('net', weightExpr('product', 'prices'))])).toBe(true)
		expect(
			calcUsesSources([
				calcField('tax', {
					type: 'op',
					op: '*',
					left: { type: 'ref', field: 'net' },
					right: sourceExpr('taxRate'),
				}),
			])
		).toBe(true)
	})
})

describe('resolveCalcContext', () => {
	it('resolves each used scalar source once, deduped across expressions', async () => {
		const resolve = vi.fn().mockResolvedValue(0.19)
		const resolved = await resolveCalcContext({
			fields: [
				calcField('tax', sourceExpr('taxRate')),
				calcField('taxAgain', {
					type: 'op',
					op: '+',
					left: sourceExpr('taxRate'),
					right: sourceExpr('taxRate'),
				}),
			],
			sources: { taxRate: defineCalcSource({ label: 'Tax', resolve }) },
			form,
			payload,
		})
		expect(resolve).toHaveBeenCalledTimes(1)
		expect(resolved).toEqual({ sources: { taxRate: 0.19 } })
	})

	it('resolves each (source, field) weight pair once with the referenced field instance', async () => {
		const resolveWeights = vi.fn().mockResolvedValue({ a: 10 })
		const product: FormFieldInstance = { blockType: 'select', name: 'product', options: [] }
		const resolved = await resolveCalcContext({
			fields: [
				product,
				calcField('net', weightExpr('product', 'prices')),
				calcField('netAgain', weightExpr('product', 'prices')),
			],
			sources: { prices: defineCalcSource({ label: 'Prices', resolveWeights }) },
			form,
			payload,
		})
		expect(resolveWeights).toHaveBeenCalledTimes(1)
		expect(resolveWeights.mock.calls[0]?.[0]?.field).toBe(product)
		expect(resolved).toEqual({ weights: { 'prices product': { a: 10 } } })
	})

	it('resolves a weight pair whose field instance is missing to an empty map without calling the resolver', async () => {
		const resolveWeights = vi.fn().mockResolvedValue({ a: 10 })
		const resolved = await resolveCalcContext({
			fields: [calcField('net', weightExpr('missing', 'prices'))],
			sources: { prices: defineCalcSource({ label: 'Prices', resolveWeights }) },
			form,
			payload,
		})
		expect(resolveWeights).not.toHaveBeenCalled()
		expect(resolved).toEqual({ weights: { 'prices missing': {} } })
	})

	it('returns an empty context without touching resolvers when nothing is used', async () => {
		const resolve = vi.fn()
		const resolved = await resolveCalcContext({
			fields: [calcField('total', { type: 'ref', field: 'a' })],
			sources: { taxRate: defineCalcSource({ label: 'Tax', resolve }) },
			form,
			payload,
		})
		expect(resolve).not.toHaveBeenCalled()
		expect(resolved).toEqual({})
	})

	it('rejects when a used scalar source is unregistered', async () => {
		await expect(
			resolveCalcContext({
				fields: [calcField('tax', sourceExpr('taxRate'))],
				sources: {},
				form,
				payload,
			})
		).rejects.toThrow(/taxRate/)
	})

	it('rejects when a used scalar source has no resolve', async () => {
		await expect(
			resolveCalcContext({
				fields: [calcField('tax', sourceExpr('prices'))],
				sources: { prices: defineCalcSource({ label: 'Prices', resolveWeights: () => ({}) }) },
				form,
				payload,
			})
		).rejects.toThrow(/prices/)
	})

	it('rejects when a used weight source has no resolveWeights', async () => {
		await expect(
			resolveCalcContext({
				fields: [calcField('net', weightExpr('product', 'taxRate'))],
				sources: { taxRate: defineCalcSource({ label: 'Tax', resolve: () => 0.19 }) },
				form,
				payload,
			})
		).rejects.toThrow(/taxRate/)
	})

	it('propagates a throwing resolver', async () => {
		await expect(
			resolveCalcContext({
				fields: [calcField('tax', sourceExpr('taxRate'))],
				sources: {
					taxRate: defineCalcSource({
						label: 'Tax',
						resolve: () => {
							throw new Error('backend down')
						},
					}),
				},
				form,
				payload,
			})
		).rejects.toThrow('backend down')
	})
})
