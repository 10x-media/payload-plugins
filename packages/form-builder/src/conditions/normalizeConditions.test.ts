import { describe, expect, it } from 'vitest'
import { normalizeFormConditions } from './normalizeConditions'

const fText = { blockType: 'text', name: 'firstName' }
const fNumber = { blockType: 'number', name: 'age' }
const fSelect = { blockType: 'select', name: 'country' }
const conditionTypes = { text: 'text', number: 'number', select: 'select' } as const

describe('normalizeFormConditions', () => {
	it('normalizes shorthand into canonical OR-of-ANDs', () => {
		const next = normalizeFormConditions(
			[{ ...fText, visibleWhen: { firstName: { equals: 'Sam' } } }, fNumber, fSelect],
			conditionTypes
		)
		expect(next[0]?.visibleWhen).toEqual({ or: [{ and: [{ firstName: { equals: 'Sam' } }] }] })
	})

	it('drops a constraint referencing an unknown field', () => {
		const next = normalizeFormConditions(
			[
				{ ...fText, visibleWhen: { or: [{ and: [{ ghost: { equals: 'x' } }] }] } },
				fNumber,
				fSelect,
			],
			conditionTypes
		)
		expect(next[0]?.visibleWhen).toBeUndefined()
	})

	it('drops an operator not valid for the field type (greater_than on text)', () => {
		const next = normalizeFormConditions(
			[
				{ ...fText, validateWhen: { or: [{ and: [{ firstName: { greater_than: 3 } }] }] } },
				fNumber,
				fSelect,
			],
			conditionTypes
		)
		expect(next[0]?.validateWhen).toBeUndefined()
	})

	it('keeps a valid number ordering condition', () => {
		const next = normalizeFormConditions(
			[fText, { ...fNumber, visibleWhen: { age: { greater_than: 18 } } }, fSelect],
			conditionTypes
		)
		expect(next[1]?.visibleWhen).toEqual({ or: [{ and: [{ age: { greater_than: 18 } }] }] })
	})

	it('strips a constraint referencing a non-conditionable field type (message)', () => {
		const next = normalizeFormConditions(
			[
				{ blockType: 'message', name: 'note' },
				{ ...fText, visibleWhen: { note: { exists: true } } },
			],
			conditionTypes
		)
		expect(next[1]?.visibleWhen).toBeUndefined()
	})
})
