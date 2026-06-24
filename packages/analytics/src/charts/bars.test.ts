import { describe, expect, it } from 'vitest'
import { toBarRows } from './bars'

describe('toBarRows', () => {
	it('scales each value to a fraction of the max', () => {
		expect(
			toBarRows([
				{ label: 'a', value: 10 },
				{ label: 'b', value: 5 },
			])
		).toEqual([
			{ label: 'a', value: 10, fraction: 1 },
			{ label: 'b', value: 5, fraction: 0.5 },
		])
	})

	it('uses zero fractions when every value is zero', () => {
		expect(
			toBarRows([
				{ label: 'a', value: 0 },
				{ label: 'b', value: 0 },
			])
		).toEqual([
			{ label: 'a', value: 0, fraction: 0 },
			{ label: 'b', value: 0, fraction: 0 },
		])
	})

	it('returns an empty array for no data', () => {
		expect(toBarRows([])).toEqual([])
	})
})
