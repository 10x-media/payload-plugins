import { describe, expect, it } from 'vitest'
import { dateOf, jsonOf, numberOf, stringOf, textOf } from './columnValues'

describe('column values', () => {
	it('reads numbers out of what each driver returns', () => {
		expect(numberOf('42')).toBe(42)
		expect(numberOf(42n)).toBe(42)
		expect(numberOf(4.5)).toBe(4.5)
		expect(numberOf(null)).toBeNull()
		expect(numberOf(undefined)).toBeNull()
		expect(numberOf('many')).toBeNull()
	})

	it('reads an instant from a Date, ISO text or nothing usable', () => {
		const iso = '2026-10-06T12:00:00.000Z'
		expect(dateOf(new Date(iso))?.toISOString()).toBe(iso)
		expect(dateOf(iso)?.toISOString()).toBe(iso)
		for (const value of [null, undefined, 'soon', {}, new Date(Number.NaN)]) {
			expect(dateOf(value), String(value)).toBeNull()
		}
	})

	it('reads text strictly or as any present value', () => {
		expect(textOf(7)).toBe('7')
		expect(textOf(null)).toBeNull()
		expect(stringOf(7)).toBeNull()
		expect(stringOf('a')).toBe('a')
	})

	it('parses JSON text and passes parsed values through', () => {
		expect(jsonOf('{"a":1}')).toEqual({ a: 1 })
		expect(jsonOf({ a: 1 })).toEqual({ a: 1 })
		expect(jsonOf('{')).toBeUndefined()
	})
})
