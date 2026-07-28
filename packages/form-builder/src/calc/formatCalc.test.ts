import { describe, expect, it } from 'vitest'
import { formatCalc } from './formatCalc'
import type { CalcExpression } from './types'

const labelOf = (field: string): string => {
	const labels: Record<string, string> = {
		price: 'Price',
		qty: 'Quantity',
		a: 'A',
		b: 'B',
		c: 'C',
		score: 'Score',
		size: 'Size',
	}
	return labels[field] ?? field
}

describe('formatCalc', () => {
	it('formats a lone literal', () => {
		const expr: CalcExpression = { type: 'lit', value: 42 }
		expect(formatCalc(expr, labelOf)).toBe('42')
	})

	it('formats a lone field reference via labelOf', () => {
		const expr: CalcExpression = { type: 'ref', field: 'price' }
		expect(formatCalc(expr, labelOf)).toBe('Price')
	})

	it('formats negation of a literal with the minus sign glyph', () => {
		const expr: CalcExpression = { type: 'neg', operand: { type: 'lit', value: 5 } }
		expect(formatCalc(expr, labelOf)).toBe('−5')
	})

	it('parenthesizes a binary-op operand under negation', () => {
		const expr: CalcExpression = {
			type: 'neg',
			operand: {
				type: 'op',
				op: '+',
				left: { type: 'lit', value: 1 },
				right: { type: 'lit', value: 2 },
			},
		}
		expect(formatCalc(expr, labelOf)).toBe('−(1 + 2)')
	})

	it('formats a function call with recursively formatted args', () => {
		const expr: CalcExpression = {
			type: 'fn',
			fn: 'max',
			args: [
				{ type: 'ref', field: 'a' },
				{ type: 'lit', value: 3 },
			],
		}
		expect(formatCalc(expr, labelOf)).toBe('max(A, 3)')
	})

	it('formats a weight node as weights(label)', () => {
		const expr: CalcExpression = {
			type: 'weight',
			field: 'size',
			weights: { S: 1, M: 2 },
		}
		expect(formatCalc(expr, labelOf)).toBe('weights(Size)')
	})

	it('formats nested arithmetic, parenthesizing binary-op children and mapping glyphs', () => {
		const expr: CalcExpression = {
			type: 'op',
			op: '*',
			left: {
				type: 'op',
				op: '*',
				left: { type: 'ref', field: 'price' },
				right: { type: 'ref', field: 'qty' },
			},
			right: { type: 'lit', value: 1.19 },
		}
		expect(formatCalc(expr, labelOf)).toBe('(Price × Quantity) × 1.19')
	})

	it('does not parenthesize a function-call operand of a binary op', () => {
		const expr: CalcExpression = {
			type: 'op',
			op: '+',
			left: {
				type: 'fn',
				fn: 'max',
				args: [
					{
						type: 'op',
						op: '-',
						left: { type: 'ref', field: 'a' },
						right: { type: 'ref', field: 'b' },
					},
					{ type: 'lit', value: 0 },
				],
			},
			right: { type: 'ref', field: 'c' },
		}
		expect(formatCalc(expr, labelOf)).toBe('max(A − B, 0) + C')
	})

	it('maps all four arithmetic glyphs', () => {
		const build = (op: '+' | '-' | '*' | '/'): CalcExpression => ({
			type: 'op',
			op,
			left: { type: 'lit', value: 1 },
			right: { type: 'lit', value: 2 },
		})
		expect(formatCalc(build('+'), labelOf)).toBe('1 + 2')
		expect(formatCalc(build('-'), labelOf)).toBe('1 − 2')
		expect(formatCalc(build('*'), labelOf)).toBe('1 × 2')
		expect(formatCalc(build('/'), labelOf)).toBe('1 ÷ 2')
	})
})
