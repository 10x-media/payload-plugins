import type { Where } from 'payload'
import { describe, expect, it } from 'vitest'
import { evaluateCondition } from './evaluate'

const cond = (field: string, operator: string, value: unknown): Where => ({
	or: [{ and: [{ [field]: { [operator]: value } }] }],
})

describe('evaluateCondition', () => {
	it('matches an absent or empty condition (match-all)', () => {
		expect(evaluateCondition(undefined, {})).toBe(true)
		expect(evaluateCondition(null, {})).toBe(true)
		expect(evaluateCondition({}, {})).toBe(true)
		expect(evaluateCondition({ or: [] }, {})).toBe(true)
	})

	it('equals: strict, with numeric and boolean coercion', () => {
		expect(evaluateCondition(cond('a', 'equals', 'x'), { a: 'x' })).toBe(true)
		expect(evaluateCondition(cond('a', 'equals', 'x'), { a: 'y' })).toBe(false)
		expect(evaluateCondition(cond('n', 'equals', '5'), { n: 5 })).toBe(true)
		expect(evaluateCondition(cond('b', 'equals', 'true'), { b: true })).toBe(true)
		expect(evaluateCondition(cond('a', 'equals', null), { a: null })).toBe(true)
		expect(evaluateCondition(cond('a', 'equals', null), { a: 'x' })).toBe(false)
	})

	it('not_equals: null-inclusive (absent answer matches)', () => {
		expect(evaluateCondition(cond('a', 'not_equals', 'x'), { a: 'y' })).toBe(true)
		expect(evaluateCondition(cond('a', 'not_equals', 'x'), { a: 'x' })).toBe(false)
		expect(evaluateCondition(cond('a', 'not_equals', 'x'), {})).toBe(true)
	})

	it('in / not_in: membership with comma-string support', () => {
		expect(evaluateCondition(cond('a', 'in', ['x', 'y']), { a: 'y' })).toBe(true)
		expect(evaluateCondition(cond('a', 'in', 'x,y'), { a: 'y' })).toBe(true)
		expect(evaluateCondition(cond('a', 'in', ['x']), { a: 'z' })).toBe(false)
		expect(evaluateCondition(cond('a', 'not_in', ['x']), { a: 'z' })).toBe(true)
		expect(evaluateCondition(cond('a', 'not_in', ['x']), {})).toBe(true)
	})

	it('exists: empty string and absent count as not-existing', () => {
		expect(evaluateCondition(cond('a', 'exists', true), { a: 'x' })).toBe(true)
		expect(evaluateCondition(cond('a', 'exists', true), { a: '' })).toBe(false)
		expect(evaluateCondition(cond('a', 'exists', true), {})).toBe(false)
		expect(evaluateCondition(cond('a', 'exists', false), {})).toBe(true)
		expect(evaluateCondition(cond('b', 'exists', true), { b: false })).toBe(true)
	})

	it('numeric ordering (and date strings)', () => {
		expect(evaluateCondition(cond('n', 'greater_than', 3), { n: 5 })).toBe(true)
		expect(evaluateCondition(cond('n', 'greater_than', 5), { n: 5 })).toBe(false)
		expect(evaluateCondition(cond('n', 'greater_than_equal', 5), { n: 5 })).toBe(true)
		expect(evaluateCondition(cond('n', 'less_than', 3), { n: 5 })).toBe(false)
		expect(evaluateCondition(cond('d', 'greater_than', '2020-01-01'), { d: '2021-01-01' })).toBe(
			true
		)
		expect(evaluateCondition(cond('n', 'greater_than', 3), { n: 'abc' })).toBe(false)
	})

	it('like: case-insensitive, space-split AND substring', () => {
		expect(evaluateCondition(cond('s', 'like', 'foo bar'), { s: 'a FOO and BAR b' })).toBe(true)
		expect(evaluateCondition(cond('s', 'like', 'foo bar'), { s: 'only foo' })).toBe(false)
		expect(evaluateCondition(cond('s', 'not_like', 'foo'), { s: 'bar' })).toBe(true)
	})

	it('not_like is the logical negation of like (at least one word absent)', () => {
		expect(evaluateCondition(cond('s', 'not_like', 'foo bar'), { s: 'has foo only' })).toBe(true)
		expect(evaluateCondition(cond('s', 'not_like', 'foo bar'), { s: 'foo and bar' })).toBe(false)
	})

	it('ANDs a top-level or and and sibling', () => {
		const where: Where = {
			or: [{ and: [{ a: { equals: 'x' } }] }],
			and: [{ b: { equals: 'y' } }],
		}
		expect(evaluateCondition(where, { a: 'x', b: 'y' })).toBe(true)
		expect(evaluateCondition(where, { a: 'x', b: 'z' })).toBe(false)
	})

	it('evaluates a nested or within an and group', () => {
		const where: Where = {
			or: [
				{
					and: [{ a: { equals: 'x' } }, { or: [{ b: { equals: 'y' } }, { b: { equals: 'z' } }] }],
				},
			],
		}
		expect(evaluateCondition(where, { a: 'x', b: 'z' })).toBe(true)
		expect(evaluateCondition(where, { a: 'x', b: 'w' })).toBe(false)
	})

	it('contains: case-insensitive substring, not space-split', () => {
		expect(evaluateCondition(cond('s', 'contains', 'oo b'), { s: 'FOO BAR' })).toBe(true)
		expect(evaluateCondition(cond('s', 'contains', 'foo bar'), { s: 'foo and bar' })).toBe(false)
	})

	it('AND within a group, OR across groups', () => {
		const where: Where = {
			or: [
				{ and: [{ a: { equals: 'x' } }, { n: { greater_than: 3 } }] },
				{ and: [{ a: { equals: 'z' } }] },
			],
		}
		expect(evaluateCondition(where, { a: 'x', n: 5 })).toBe(true)
		expect(evaluateCondition(where, { a: 'x', n: 1 })).toBe(false)
		expect(evaluateCondition(where, { a: 'z', n: 1 })).toBe(true)
	})

	it('normalizes shorthand via transformWhereQuery', () => {
		expect(evaluateCondition({ a: { equals: 'x' } } as Where, { a: 'x' })).toBe(true)
		expect(evaluateCondition({ and: [{ a: { equals: 'x' } }] } as Where, { a: 'x' })).toBe(true)
	})

	it('out-of-scope operators evaluate to false', () => {
		expect(evaluateCondition(cond('a', 'near', [0, 0]), { a: 'x' })).toBe(false)
	})
})
