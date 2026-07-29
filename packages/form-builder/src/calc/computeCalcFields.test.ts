import { describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { calcExpressionOf, computeCalcFields } from './computeCalcFields'
import type { CalcExpression } from './types'

const mkField = (name: string, extra?: Record<string, unknown>): FormFieldInstance => ({
	blockType: 'number',
	name,
	...extra,
})

const add = (a: string, b: string): CalcExpression => ({
	type: 'op',
	op: '+',
	left: { type: 'ref', field: a },
	right: { type: 'ref', field: b },
})

describe('calcExpressionOf', () => {
	it('returns the expression object when expression is an object', () => {
		const expr: CalcExpression = { type: 'lit', value: 1 }
		const field = mkField('x', { expression: expr })
		expect(calcExpressionOf(field)).toBe(expr)
	})

	it('returns undefined when expression is a string', () => {
		const field = mkField('x', { expression: 'oops' })
		expect(calcExpressionOf(field)).toBeUndefined()
	})

	it('returns undefined when expression is a number', () => {
		const field = mkField('x', { expression: 42 })
		expect(calcExpressionOf(field)).toBeUndefined()
	})

	it('returns undefined when expression is null', () => {
		const field = mkField('x', { expression: null })
		expect(calcExpressionOf(field)).toBeUndefined()
	})

	it('returns undefined when expression is absent', () => {
		const field = mkField('x')
		expect(calcExpressionOf(field)).toBeUndefined()
	})
})

describe('computeCalcFields', () => {
	it('derives a single calc field from referenced inputs', () => {
		const fields: FormFieldInstance[] = [
			mkField('a'),
			mkField('b'),
			mkField('total', { expression: add('a', 'b') }),
		]
		const result = computeCalcFields(fields, { a: 3, b: 7 })
		expect(result.total).toBe(10)
	})

	it('chained: grandTotal refs total declared earlier; uses computed value', () => {
		const fields: FormFieldInstance[] = [
			mkField('a'),
			mkField('total', { expression: add('a', 'a') }),
			mkField('grandTotal', {
				expression: {
					type: 'op',
					op: '*',
					left: { type: 'ref', field: 'total' },
					right: { type: 'lit', value: 2 },
				} satisfies CalcExpression,
			}),
		]
		const result = computeCalcFields(fields, { a: 5 })
		expect(result.total).toBe(10)
		expect(result.grandTotal).toBe(20)
	})

	it('identity: no calc fields -> returns an object equal to inputs', () => {
		const fields: FormFieldInstance[] = [mkField('a'), mkField('b')]
		const answers = { a: 1, b: 2 }
		const result = computeCalcFields(fields, answers)
		expect(result).toEqual({ a: 1, b: 2 })
	})

	it('identity: does not invent keys for non-calc fields', () => {
		const fields: FormFieldInstance[] = [mkField('x'), mkField('y')]
		const answers = { x: 10 }
		const result = computeCalcFields(fields, answers)
		expect(Object.keys(result)).toEqual(['x'])
	})

	it('field with non-object expression is skipped; value in answers is untouched', () => {
		const fields: FormFieldInstance[] = [mkField('x', { expression: 'oops' })]
		const answers = { x: 99 }
		const result = computeCalcFields(fields, answers)
		expect(result.x).toBe(99)
	})

	it('original answers object is not mutated', () => {
		const fields: FormFieldInstance[] = [
			mkField('total', { expression: { type: 'lit', value: 5 } satisfies CalcExpression }),
		]
		const answers = { a: 1 }
		computeCalcFields(fields, answers)
		expect(Object.keys(answers)).toEqual(['a'])
	})
})

describe('computeCalcFields with resolved context', () => {
	it('threads resolved sources, weights, and functions into evaluation', () => {
		const fields: FormFieldInstance[] = [
			mkField('product'),
			mkField('net', {
				expression: {
					type: 'weight',
					field: 'product',
					source: 'productPrices',
				} satisfies CalcExpression,
			}),
			mkField('tax', {
				expression: {
					type: 'op',
					op: '*',
					left: { type: 'ref', field: 'net' },
					right: { type: 'source', source: 'taxRate' },
				} satisfies CalcExpression,
			}),
			mkField('doubled', {
				expression: {
					type: 'fn',
					fn: 'double',
					args: [{ type: 'ref', field: 'net' }],
				} satisfies CalcExpression,
			}),
		]
		const result = computeCalcFields(
			fields,
			{ product: 'a' },
			{
				sources: { taxRate: 0.5 },
				weights: { 'productPrices product': { a: 100 } },
				functions: { double: (args) => (args[0] ?? 0) * 2 },
			}
		)
		expect(result.net).toBe(100)
		expect(result.tax).toBe(50)
		expect(result.doubled).toBe(200)
	})

	it('without resolved context, extension nodes degrade to 0', () => {
		const fields: FormFieldInstance[] = [
			mkField('tax', {
				expression: { type: 'source', source: 'taxRate' } satisfies CalcExpression,
			}),
		]
		expect(computeCalcFields(fields, {}).tax).toBe(0)
	})
})
