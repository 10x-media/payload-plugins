import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { formBuilder } from '../index'
import {
	assertNoCalcFunctionCollision,
	assertValidCalcSourceKeys,
	defineCalcFunction,
	defineCalcSource,
} from './registry'

describe('defineCalcSource / defineCalcFunction', () => {
	it('are identity helpers', () => {
		const source = defineCalcSource({ label: 'Tax rate', resolve: () => 0.19 })
		expect(source.label).toBe('Tax rate')
		const fn = defineCalcFunction({ label: 'Double', apply: (args) => (args[0] ?? 0) * 2 })
		expect(fn.apply([21])).toBe(42)
	})
})

describe('assertNoCalcFunctionCollision', () => {
	it('throws when a custom function key collides with a built-in', () => {
		expect(() =>
			assertNoCalcFunctionCollision({
				round: defineCalcFunction({ label: 'Round', apply: () => 0 }),
			})
		).toThrow(/round/)
	})

	it('passes non-colliding keys', () => {
		expect(() =>
			assertNoCalcFunctionCollision({
				double: defineCalcFunction({ label: 'Double', apply: () => 0 }),
			})
		).not.toThrow()
	})
})

describe('assertValidCalcSourceKeys', () => {
	it('throws on a key containing a space (the weight-map key separator)', () => {
		expect(() =>
			assertValidCalcSourceKeys({
				'tax rate': defineCalcSource({ label: 'Tax', resolve: () => 0 }),
			})
		).toThrow(/tax rate/)
	})

	it('passes word characters, dots, and dashes', () => {
		expect(() =>
			assertValidCalcSourceKeys({
				'tax-rate.v2_x': defineCalcSource({ label: 'Tax', resolve: () => 0 }),
			})
		).not.toThrow()
	})
})

describe('formBuilder boot collision', () => {
	it('throws at plugin apply when a calc function collides with a built-in', () => {
		const plugin = formBuilder({
			calc: { functions: { min: defineCalcFunction({ label: 'Min', apply: () => 0 }) } },
		})
		expect(() => plugin({ collections: [] } as unknown as Config)).toThrow(/min/)
	})

	it('throws at plugin apply on a calc source key with a space', () => {
		const plugin = formBuilder({
			calc: { sources: { 'tax rate': defineCalcSource({ label: 'Tax', resolve: () => 0 }) } },
		})
		expect(() => plugin({ collections: [] } as unknown as Config)).toThrow(/tax rate/)
	})
})
