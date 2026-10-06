import { describe, expect, it } from 'vitest'

import { bySortKey } from './sort'

type Row = { key?: number | string; name: string }

const order = (rows: Row[]) => bySortKey(rows, (row) => row.key).map((row) => row.name)

describe('bySortKey', () => {
	it('leaves unkeyed entries in declaration order', () => {
		expect(order([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toEqual(['a', 'b', 'c'])
	})

	it('puts keyed entries before unkeyed ones', () => {
		expect(order([{ name: 'a' }, { key: 1, name: 'b' }])).toEqual(['b', 'a'])
	})

	it('is stable for equal keys', () => {
		expect(
			order([
				{ key: 1, name: 'a' },
				{ key: 1, name: 'b' },
				{ key: 0, name: 'c' },
			])
		).toEqual(['c', 'a', 'b'])
	})

	it('sorts strings alphabetically', () => {
		expect(
			order([
				{ key: 'zed', name: 'a' },
				{ key: 'alpha', name: 'b' },
			])
		).toEqual(['b', 'a'])
	})

	it('puts numbers before strings so a mixed config is defined, not merely tolerated', () => {
		expect(
			order([
				{ key: 'alpha', name: 'a' },
				{ key: 99, name: 'b' },
			])
		).toEqual(['b', 'a'])
	})
})
