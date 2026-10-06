import { describe, expect, it } from 'vitest'
import { keys } from './keys'
import { makeTranslate } from './makeTranslate'

describe('makeTranslate', () => {
	it('resolves a known locale string to that shipped bundle', () => {
		const t = makeTranslate('de')
		expect(t(keys.formSubmit)).toBe('Absenden')
	})

	it('falls back to English for an unknown locale (never the raw key)', () => {
		const t = makeTranslate('xx')
		expect(t(keys.formSubmit)).toBe('Submit')
	})

	it('accepts an explicit map verbatim (unchanged behavior)', () => {
		const t = makeTranslate({ [keys.formSubmit]: 'Go' })
		expect(t(keys.formSubmit)).toBe('Go')
	})

	it('returns the key itself when a map lacks it', () => {
		const t = makeTranslate({})
		expect(t(keys.formSubmit)).toBe(keys.formSubmit)
	})
})
