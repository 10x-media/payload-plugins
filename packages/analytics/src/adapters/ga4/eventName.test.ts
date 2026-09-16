import { describe, expect, it } from 'vitest'
import { ga4EventName } from './eventName'

describe('ga4EventName', () => {
	it('turns a kebab-case goal slug into an underscored event name', () => {
		expect(ga4EventName('checkout-complete')).toBe('checkout_complete')
	})

	it('leaves a name GA4 already accepts alone', () => {
		expect(ga4EventName('sign_up2')).toBe('sign_up2')
	})

	it('prefixes a name that does not start with a letter', () => {
		expect(ga4EventName('2026-signups')).toBe('e_2026_signups')
		expect(ga4EventName('_internal')).toBe('e__internal')
	})

	it('drops characters outside letters, digits and underscores', () => {
		expect(ga4EventName('café.checkout')).toBe('cafcheckout')
		expect(ga4EventName('買い物-完了')).toBe('e__')
	})

	it('truncates to 40 characters', () => {
		const name = ga4EventName(`${'a'.repeat(50)}-done`)
		expect(name).toHaveLength(40)
		expect(name).toBe('a'.repeat(40))
	})

	it('counts the prefix towards the 40 characters', () => {
		expect(ga4EventName('9'.repeat(50))).toBe(`e_${'9'.repeat(38)}`)
	})
})
