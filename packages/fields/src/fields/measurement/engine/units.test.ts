import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	COMPOUNDS,
	dimensionOf,
	isCompoundUnit,
	type ScalarOfDimension,
	UNITS,
	type UnitOfDimension,
	unitsOfDimension,
} from './units'

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

describe('dimension-narrowing types', () => {
	it('ScalarOfDimension keeps only scalars of that dimension', () => {
		expectTypeOf<'kg'>().toExtend<ScalarOfDimension<'mass'>>()
		expectTypeOf<'cm'>().not.toExtend<ScalarOfDimension<'mass'>>()
	})
	it('UnitOfDimension adds compounds whose major matches, not ones that do not', () => {
		expectTypeOf<'ft-in'>().toExtend<UnitOfDimension<'length'>>()
		expectTypeOf<'st-lb'>().not.toExtend<UnitOfDimension<'length'>>()
	})
})

describe('unitsOfDimension', () => {
	it('includes built-in scalars and compounds keyed by their major', () => {
		const length = unitsOfDimension('length')
		expect(length).toContain('ft-in')
		expect(length).not.toContain('st-lb')

		const mass = unitsOfDimension('mass')
		expect(mass).toContain('st-lb')
		expect(mass).not.toContain('ft-in')
	})
	it('every returned unit actually belongs to the requested dimension', () => {
		for (const dimension of ['length', 'mass', 'volume', 'temperature', 'speed'] as const) {
			for (const unit of unitsOfDimension(dimension)) {
				expect(dimensionOf(unit)).toBe(dimension)
			}
		}
	})
})
