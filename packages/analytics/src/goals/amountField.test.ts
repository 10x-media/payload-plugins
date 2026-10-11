import type { NumberField } from 'payload'
import { describe, expect, it } from 'vitest'
import { amountField, GOAL_AMOUNT_FIELD_COMPONENT, siblingPath } from './amountField'

describe('siblingPath', () => {
	it('finds a plain name beside the field', () => {
		expect(siblingPath('actions.0.value', 'currency')).toBe('actions.0.currency')
		expect(siblingPath('fixed', 'currency')).toBe('currency')
	})

	it('climbs one enclosing group per leading ../', () => {
		expect(siblingPath('value.fixed', '../currency')).toBe('currency')
		expect(siblingPath('money.value.fixed', '../currency')).toBe('money.currency')
		expect(siblingPath('a.b.c', '../../x')).toBe('x')
	})

	it('stops at the top of the document', () => {
		expect(siblingPath('value.fixed', '../../../currency')).toBe('currency')
	})
})

describe('amountField', () => {
	it('keeps the number field as it was and draws it as the Amount control', () => {
		const field: NumberField = {
			name: 'fixed',
			type: 'number',
			min: 0,
			admin: { description: 'Worth', components: { afterInput: ['/components/Note#Note'] } },
		}
		const built = amountField(field, { currencyPath: '../currency', defaultCurrency: 'EUR' })
		expect(built).toMatchObject({ name: 'fixed', type: 'number', min: 0 })
		expect(built.admin?.description).toBe('Worth')
		expect(built.admin?.components?.afterInput).toEqual(['/components/Note#Note'])
		expect(built.admin?.components?.Field).toEqual({
			path: GOAL_AMOUNT_FIELD_COMPONENT,
			clientProps: { currencyPath: '../currency', defaultCurrency: 'EUR' },
		})
		expect(field.admin?.components?.Field).toBeUndefined()
	})
})
