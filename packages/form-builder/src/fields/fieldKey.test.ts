import { describe, expect, it } from 'vitest'
import { fieldKey, isNamedField } from './fieldKey'

describe('fieldKey', () => {
	it('returns the machine name for a named field', () => {
		expect(fieldKey({ blockType: 'text', name: 'email', id: 'row-1' })).toBe('email')
	})

	it('falls back to the stringified block row id for a nameless field', () => {
		expect(fieldKey({ blockType: 'message', id: 'row-1' })).toBe('row-1')
		expect(fieldKey({ blockType: 'message', id: 42 })).toBe('42')
	})

	it('prefers the name even when a row id is present', () => {
		expect(fieldKey({ blockType: 'text', name: 'a', id: 'b' })).toBe('a')
	})
})

describe('isNamedField', () => {
	it('accepts a named instance and rejects a nameless one', () => {
		expect(isNamedField({ blockType: 'text', name: 'a' })).toBe(true)
		expect(isNamedField({ blockType: 'message', id: 'row-1' })).toBe(false)
	})
})
