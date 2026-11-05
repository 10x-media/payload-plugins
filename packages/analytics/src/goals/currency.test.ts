import { describe, expect, it } from 'vitest'
import { revenueCurrencyOf, rowCurrencyOf } from './currency'

describe('revenueCurrencyOf', () => {
	it('is the reporting currency for a read that does not filter by currency', () => {
		expect(revenueCurrencyOf(undefined, 'EUR')).toBe('EUR')
		expect(revenueCurrencyOf([{ dimension: 'page', operator: 'eq', value: '/x' }], 'EUR')).toBe(
			'EUR'
		)
		expect(revenueCurrencyOf([], undefined)).toBeUndefined()
	})

	it('is the code a read keeps with an `eq` currency filter, reporting currency or none', () => {
		const usd = [{ dimension: 'currency', operator: 'eq', value: 'USD' }] as const
		expect(revenueCurrencyOf(usd, 'EUR')).toBe('USD')
		expect(revenueCurrencyOf(usd, undefined)).toBe('USD')
		expect(
			revenueCurrencyOf([{ dimension: 'currency', operator: 'eq', value: 'usd' }], 'EUR')
		).toBe(undefined)
	})

	it('is none for a currency filter that can keep several', () => {
		expect(
			revenueCurrencyOf([{ dimension: 'currency', operator: 'contains', value: 'U' }], 'EUR')
		).toBeUndefined()
	})
})

describe('rowCurrencyOf', () => {
	it('formats a currency row in its own code, every other row as the read', () => {
		expect(rowCurrencyOf('currency', 'USD', 'EUR')).toBe('USD')
		expect(rowCurrencyOf('currency', 'not a code', 'EUR')).toBe('EUR')
		expect(rowCurrencyOf('page', 'USD', 'EUR')).toBe('EUR')
		expect(rowCurrencyOf(null, 'USD', undefined)).toBeUndefined()
	})
})
