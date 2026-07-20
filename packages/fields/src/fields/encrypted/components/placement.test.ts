import { describe, expect, it } from 'vitest'
import { placementFor } from './placement'

describe('placementFor', () => {
	it('attaches the eye to single text, email, and number inputs', () => {
		expect(placementFor('text', false)).toBe('attached')
		expect(placementFor('email', false)).toBe('attached')
		expect(placementFor('number', false)).toBe('attached')
	})

	it('corners the eye for textarea', () => {
		expect(placementFor('textarea', false)).toBe('corner')
	})

	it('uses the label row for every structural type', () => {
		for (const key of ['checkbox', 'select', 'radio', 'date', 'code', 'json', 'point']) {
			expect(placementFor(key, false)).toBe('label-row')
		}
	})

	it('forces hasMany fields to the label row regardless of type', () => {
		expect(placementFor('text', true)).toBe('label-row')
		expect(placementFor('number', true)).toBe('label-row')
		expect(placementFor('select', true)).toBe('label-row')
	})
})
