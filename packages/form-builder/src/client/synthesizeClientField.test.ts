import { describe, expect, it } from 'vitest'
import { type FieldRow, operandFromRow } from './synthesizeClientField'

describe('operandFromRow', () => {
	it('maps a named text row to a text operand', () => {
		const row: FieldRow = { blockType: 'text', name: 'firstName', label: 'First name' }
		expect(operandFromRow(row, { text: 'text' })).toEqual({
			name: 'firstName',
			label: 'First name',
			conditionType: 'text',
			options: undefined,
		})
	})

	it('carries select options through', () => {
		const row: FieldRow = {
			blockType: 'select',
			name: 'country',
			options: [{ label: 'US', value: 'us' }],
		}
		const operand = operandFromRow(row, { select: 'select' })
		expect(operand?.conditionType).toBe('select')
		expect(operand?.options).toEqual([{ label: 'US', value: 'us' }])
	})

	it('falls back to the name when label is absent', () => {
		const operand = operandFromRow({ blockType: 'text', name: 'x' }, { text: 'text' })
		expect(operand?.label).toBe('x')
	})

	it('skips rows whose type is absent from the map (not conditionable, e.g. message)', () => {
		expect(operandFromRow({ blockType: 'message', name: 'note' }, { text: 'text' })).toBeNull()
	})

	it('skips rows without a usable name', () => {
		expect(operandFromRow({ blockType: 'text', name: '' }, { text: 'text' })).toBeNull()
		expect(operandFromRow({ blockType: 'text' } as FieldRow, { text: 'text' })).toBeNull()
	})
})
