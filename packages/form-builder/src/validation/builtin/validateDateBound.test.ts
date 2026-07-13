import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { validateDateBound } from './validateDateBound'

const req = { t: (key: string) => key } as unknown as PayloadRequest

describe('validateDateBound', () => {
	it('passes a valid YYYY-MM-DD bound', () => {
		expect(validateDateBound('2024-01-15', { req })).toBe(true)
	})

	it('fails a non-date string', () => {
		expect(validateDateBound('abc', { req })).toBe('formBuilder:validation.date')
	})

	it('fails a calendar-invalid date', () => {
		expect(validateDateBound('2024-02-30', { req })).toBe('formBuilder:validation.date')
	})

	it('passes when the bound is empty', () => {
		expect(validateDateBound('', { req })).toBe(true)
		expect(validateDateBound(undefined, { req })).toBe(true)
	})
})
