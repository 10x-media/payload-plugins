import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { localizedIf } from './localizedIf'

describe('localizedIf', () => {
	it('returns the localized flag when true', () => {
		expect(localizedIf(true)).toEqual({ localized: true })
	})

	it('returns an empty object when false', () => {
		expect(localizedIf(false)).toEqual({})
	})

	it('spreads into a field without adding the key when false', () => {
		const field: Field = { name: 'label', type: 'text', ...localizedIf(false) }
		expect('localized' in field).toBe(false)
	})

	it('spreads into a field with localized true when true', () => {
		const field: Field = { name: 'label', type: 'text', ...localizedIf(true) }
		expect(field).toMatchObject({ localized: true })
	})
})
