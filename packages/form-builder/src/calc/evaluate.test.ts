import { describe, expect, it } from 'vitest'
import { evaluateCalc } from './evaluate'
import type { CalcExpression } from './types'

const lit = (value: number): CalcExpression => ({ type: 'lit', value })
const ref = (field: string): CalcExpression => ({ type: 'ref', field })
const op = (
	o: '+' | '-' | '*' | '/' | '%',
	left: CalcExpression,
	right: CalcExpression
): CalcExpression => ({ type: 'op', op: o, left, right })
const neg = (operand: CalcExpression): CalcExpression => ({ type: 'neg', operand })
const fn = (
	f: 'min' | 'max' | 'round' | 'abs' | 'ceil' | 'floor',
	args: CalcExpression[]
): CalcExpression => ({ type: 'fn', fn: f, args })
const weight = (field: string, weights: Record<string, number>): CalcExpression => ({
	type: 'weight',
	field,
	weights,
})

describe('evaluateCalc', () => {
	it('null/undefined expr returns 0', () => {
		expect(evaluateCalc(null, {})).toBe(0)
		expect(evaluateCalc(undefined, {})).toBe(0)
	})

	it('literal', () => {
		expect(evaluateCalc(lit(42), {})).toBe(42)
		expect(evaluateCalc(lit(0), {})).toBe(0)
		expect(evaluateCalc(lit(-7), {})).toBe(-7)
	})

	it('ref to a number', () => {
		expect(evaluateCalc(ref('price'), { price: 10 })).toBe(10)
	})

	it('ref to a numeric string coerces to number', () => {
		expect(evaluateCalc(ref('qty'), { qty: '3' })).toBe(3)
	})

	it('missing ref returns 0', () => {
		expect(evaluateCalc(ref('x'), {})).toBe(0)
	})

	it('empty string ref returns 0', () => {
		expect(evaluateCalc(ref('x'), { x: '' })).toBe(0)
	})

	it('ref to a non-finite string value returns 0 (totality)', () => {
		expect(evaluateCalc(ref('x'), { x: 'Infinity' })).toBe(0)
		expect(evaluateCalc(ref('x'), { x: '-Infinity' })).toBe(0)
		expect(evaluateCalc(ref('x'), { x: '1e309' })).toBe(0)
	})

	it('arithmetic operators', () => {
		expect(evaluateCalc(op('+', lit(3), lit(4)), {})).toBe(7)
		expect(evaluateCalc(op('-', lit(10), lit(3)), {})).toBe(7)
		expect(evaluateCalc(op('*', lit(3), lit(4)), {})).toBe(12)
		expect(evaluateCalc(op('/', lit(10), lit(4)), {})).toBe(2.5)
		expect(evaluateCalc(op('%', lit(10), lit(3)), {})).toBe(1)
	})

	it('division by zero returns 0', () => {
		expect(evaluateCalc(op('/', lit(5), lit(0)), {})).toBe(0)
	})

	it('modulo by zero returns 0', () => {
		expect(evaluateCalc(op('%', lit(5), lit(0)), {})).toBe(0)
	})

	it('neg', () => {
		expect(evaluateCalc(neg(lit(5)), {})).toBe(-5)
		expect(evaluateCalc(neg(lit(-3)), {})).toBe(3)
	})

	it('fn: min', () => {
		expect(evaluateCalc(fn('min', [lit(3), lit(1), lit(2)]), {})).toBe(1)
	})

	it('fn: max', () => {
		expect(evaluateCalc(fn('max', [lit(3), lit(1), lit(2)]), {})).toBe(3)
	})

	it('fn: round', () => {
		expect(evaluateCalc(fn('round', [lit(2.6)]), {})).toBe(3)
		expect(evaluateCalc(fn('round', [lit(2.4)]), {})).toBe(2)
	})

	it('fn: abs', () => {
		expect(evaluateCalc(fn('abs', [lit(-9)]), {})).toBe(9)
	})

	it('fn: ceil', () => {
		expect(evaluateCalc(fn('ceil', [lit(1.1)]), {})).toBe(2)
	})

	it('fn: floor', () => {
		expect(evaluateCalc(fn('floor', [lit(1.9)]), {})).toBe(1)
	})

	it('nested expression: (price + qty * 10)', () => {
		const expr = op('+', ref('price'), op('*', ref('qty'), lit(10)))
		expect(evaluateCalc(expr, { price: 5, qty: 3 })).toBe(35)
	})

	it('weight: scalar value maps to its weight', () => {
		const w = weight('size', { S: 1, M: 2, L: 3 })
		expect(evaluateCalc(w, { size: 'M' })).toBe(2)
	})

	it('weight: unknown option returns 0', () => {
		const w = weight('size', { S: 1 })
		expect(evaluateCalc(w, { size: 'XL' })).toBe(0)
	})

	it('weight: missing field returns 0', () => {
		const w = weight('size', { S: 1 })
		expect(evaluateCalc(w, {})).toBe(0)
	})

	it('weight: array (multi-select) sums chosen weights', () => {
		const w = weight('tags', { a: 1, b: 2, c: 4 })
		expect(evaluateCalc(w, { tags: ['a', 'c'] })).toBe(5)
	})

	it('non-finite guard: 1/0 via ref resolving to 0 -> 0 (not Infinity)', () => {
		const expr = op('/', lit(1), lit(0))
		expect(evaluateCalc(expr, {})).toBe(0)
		expect(Number.isFinite(evaluateCalc(expr, {}))).toBe(true)
	})

	it('malformed node (unknown type) returns 0', () => {
		const bogus = { type: 'bogus' } as unknown as CalcExpression
		expect(evaluateCalc(bogus, {})).toBe(0)
	})

	it('deeply nested op beyond depth 64 returns 0', () => {
		let expr: CalcExpression = lit(1)
		for (let i = 0; i < 70; i++) {
			expr = op('+', expr, lit(0))
		}
		expect(evaluateCalc(expr, {})).toBe(0)
	})
})
