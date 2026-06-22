import { describe, expect, it } from 'vitest'
import { normalizeCalc } from './normalizeCalc'
import type { CalcExpression } from './types'

describe('normalizeCalc', () => {
	it('round-trips a valid lit node', () => {
		const expr: CalcExpression = { type: 'lit', value: 42 }
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a valid ref node', () => {
		const expr: CalcExpression = { type: 'ref', field: 'price' }
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a valid op node', () => {
		const expr: CalcExpression = {
			type: 'op',
			op: '+',
			left: { type: 'lit', value: 1 },
			right: { type: 'ref', field: 'qty' },
		}
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a valid neg node', () => {
		const expr: CalcExpression = { type: 'neg', operand: { type: 'lit', value: 5 } }
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a valid fn node', () => {
		const expr: CalcExpression = {
			type: 'fn',
			fn: 'round',
			args: [{ type: 'ref', field: 'score' }],
		}
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a valid weight node', () => {
		const expr: CalcExpression = {
			type: 'weight',
			field: 'size',
			weights: { S: 1, M: 2, L: 3 },
		}
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('round-trips a deeply nested valid expression', () => {
		const expr: CalcExpression = {
			type: 'op',
			op: '*',
			left: {
				type: 'fn',
				fn: 'abs',
				args: [{ type: 'neg', operand: { type: 'ref', field: 'x' } }],
			},
			right: { type: 'lit', value: 10 },
		}
		expect(normalizeCalc(expr)).toEqual(expr)
	})

	it('returns undefined for unknown type', () => {
		expect(normalizeCalc({ type: 'bogus', value: 1 })).toBeUndefined()
	})

	it('returns undefined when op is missing right', () => {
		expect(normalizeCalc({ type: 'op', op: '+', left: { type: 'lit', value: 1 } })).toBeUndefined()
	})

	it('returns undefined when op has an invalid op value', () => {
		expect(
			normalizeCalc({
				type: 'op',
				op: '**',
				left: { type: 'lit', value: 1 },
				right: { type: 'lit', value: 2 },
			})
		).toBeUndefined()
	})

	it('returns undefined when lit value is a non-finite number', () => {
		expect(normalizeCalc({ type: 'lit', value: Infinity })).toBeUndefined()
		expect(normalizeCalc({ type: 'lit', value: NaN })).toBeUndefined()
	})

	it('returns undefined when lit value is not a number', () => {
		expect(normalizeCalc({ type: 'lit', value: '42' })).toBeUndefined()
		expect(normalizeCalc({ type: 'lit', value: null })).toBeUndefined()
	})

	it('returns undefined when ref field is not a string', () => {
		expect(normalizeCalc({ type: 'ref', field: 42 })).toBeUndefined()
	})

	it('returns undefined for non-object inputs', () => {
		expect(normalizeCalc(null)).toBeUndefined()
		expect(normalizeCalc(undefined)).toBeUndefined()
		expect(normalizeCalc('string')).toBeUndefined()
		expect(normalizeCalc(42)).toBeUndefined()
		expect(normalizeCalc([])).toBeUndefined()
	})

	it('returns undefined for an over-deep expression (> 64 levels)', () => {
		let expr: unknown = { type: 'lit', value: 1 }
		for (let i = 0; i < 70; i++) {
			expr = { type: 'neg', operand: expr }
		}
		expect(normalizeCalc(expr)).toBeUndefined()
	})

	it('returns undefined when fn name is not in allowed set', () => {
		expect(normalizeCalc({ type: 'fn', fn: 'sqrt', args: [] })).toBeUndefined()
	})

	it('returns undefined when fn args is not an array', () => {
		expect(normalizeCalc({ type: 'fn', fn: 'round', args: 'bad' })).toBeUndefined()
	})

	it('returns undefined when fn args contain an invalid sub-expression', () => {
		expect(normalizeCalc({ type: 'fn', fn: 'min', args: [{ type: 'bogus' }] })).toBeUndefined()
	})

	it('returns undefined when weight field is not a string', () => {
		expect(normalizeCalc({ type: 'weight', field: 42, weights: {} })).toBeUndefined()
	})

	it('returns undefined when weight weights contains a non-number value', () => {
		expect(normalizeCalc({ type: 'weight', field: 'size', weights: { S: '1' } })).toBeUndefined()
	})

	it('returns undefined when a weight value is non-finite', () => {
		expect(
			normalizeCalc({ type: 'weight', field: 'size', weights: { S: Number.NaN } })
		).toBeUndefined()
		expect(
			normalizeCalc({ type: 'weight', field: 'size', weights: { S: Number.POSITIVE_INFINITY } })
		).toBeUndefined()
	})

	it('returns undefined when weight weights is not an object', () => {
		expect(normalizeCalc({ type: 'weight', field: 'size', weights: null })).toBeUndefined()
	})
})
