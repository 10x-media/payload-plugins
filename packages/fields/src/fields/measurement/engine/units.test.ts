import { describe, expect, it } from 'vitest'
import { COMPOUNDS, dimensionOf, isCompoundUnit, UNITS } from './units'

describe('unit registry', () => {
	it('declares exact statute factors', () => {
		expect(UNITS.lb.factor).toBe(0.45359237)
		expect(UNITS.in.factor).toBe(0.0254)
		expect(UNITS.st.factor).toBeCloseTo(14 * 0.45359237, 12)
		expect(UNITS.mi.factor).toBe(1609.344)
		expect(UNITS.mph.factor).toBe(0.44704)
	})
	it('compounds reference scalar units of the same dimension', () => {
		for (const def of Object.values(COMPOUNDS)) {
			expect(dimensionOf(def.major)).toBe(dimensionOf(def.minor))
		}
		expect(COMPOUNDS['ft-in']).toEqual({ major: 'ft', minor: 'in', ratio: 12 })
		expect(COMPOUNDS['st-lb']).toEqual({ major: 'st', minor: 'lb', ratio: 14 })
	})
	it('classifies unit ids', () => {
		expect(isCompoundUnit('ft-in')).toBe(true)
		expect(isCompoundUnit('kg')).toBe(false)
	})
})
