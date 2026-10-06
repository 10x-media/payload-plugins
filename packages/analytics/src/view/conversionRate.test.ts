import { describe, expect, it } from 'vitest'
import { conversionRate } from './conversionRate'

describe('conversionRate', () => {
	it('answers the share of site visitors the goal converted', () => {
		expect(conversionRate(10, 100)).toBe(0.1)
		expect(conversionRate(1, 3)).toBe(0.3333)
		expect(conversionRate(0, 100)).toBe(0)
	})

	it('answers null when either side is missing', () => {
		expect(conversionRate(undefined, 100)).toBeNull()
		expect(conversionRate(10, undefined)).toBeNull()
		expect(conversionRate(undefined, undefined)).toBeNull()
	})

	it('answers null when the site total is zero, where a rate is undefined', () => {
		expect(conversionRate(0, 0)).toBeNull()
		expect(conversionRate(5, 0)).toBeNull()
	})

	it('answers null for values that are not finite numbers', () => {
		expect(conversionRate(Number.NaN, 100)).toBeNull()
		expect(conversionRate(10, Number.NaN)).toBeNull()
		expect(conversionRate(10, Number.POSITIVE_INFINITY)).toBeNull()
	})

	it('clamps a goal bucket wider than the site total, and a negative one', () => {
		expect(conversionRate(150, 100)).toBe(1)
		expect(conversionRate(-5, 100)).toBe(0)
	})
})
