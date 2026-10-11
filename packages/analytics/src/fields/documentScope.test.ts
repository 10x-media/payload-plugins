import { describe, expect, it } from 'vitest'
import type { BindingDoc } from '../binding/types'
import { scopeFromDocument } from './documentScope'

const doc = (value: unknown): BindingDoc => ({ id: 'page-1', tenant: value }) as BindingDoc

describe('scopeFromDocument', () => {
	it('reads a raw id, as a depth-0 read leaves it', () => {
		expect(scopeFromDocument(doc('alpha'), 'tenant')).toBe('alpha')
		expect(scopeFromDocument(doc(42), 'tenant')).toBe('42')
	})

	it('reads a populated relationship', () => {
		expect(scopeFromDocument(doc({ id: 'alpha', name: 'Alpha' }), 'tenant')).toBe('alpha')
	})

	// The multi-tenant plugin's array form wraps the relationship one level per row.
	it('reads the first entry of an array field, wrapped or not', () => {
		expect(scopeFromDocument(doc([{ tenant: 'alpha' }, { tenant: 'beta' }]), 'tenant')).toBe(
			'alpha'
		)
		expect(scopeFromDocument(doc(['alpha']), 'tenant')).toBe('alpha')
	})

	it('answers nothing for an empty field or a field that is off', () => {
		expect(scopeFromDocument(doc(null), 'tenant')).toBeNull()
		expect(scopeFromDocument(doc(''), 'tenant')).toBeNull()
		expect(scopeFromDocument(doc([]), 'tenant')).toBeNull()
		expect(scopeFromDocument(doc('alpha'), false)).toBeNull()
		expect(scopeFromDocument(doc('alpha'), 'missing')).toBeNull()
	})
})
