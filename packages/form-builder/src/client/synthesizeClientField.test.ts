import { describe, expect, it } from 'vitest'
import {
	type ConditionOperand,
	dateClientField,
	type FieldRow,
	numberClientField,
	operandFromRow,
	selectClientField,
	textClientField,
} from './synthesizeClientField'

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

	it('injects the fixed country/state set for types that author no options', () => {
		const country = operandFromRow({ blockType: 'country', name: 'origin' }, { country: 'select' })
		expect(country?.conditionType).toBe('select')
		expect(country?.options).toContainEqual({ label: 'Germany', value: 'DE' })
		const state = operandFromRow({ blockType: 'state', name: 'region' }, { state: 'select' })
		expect(state?.options).toContainEqual({ label: 'California', value: 'CA' })
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

describe('client field synths', () => {
	const operand: ConditionOperand = {
		name: 'country',
		label: 'Country',
		conditionType: 'select',
		options: [{ label: 'US', value: 'us' }],
	}

	// Payload's Select and Date leaf inputs read field.admin.placeholder unguarded, so a synth without
	// an admin object throws at render. Every synth must carry one.
	it('each synth carries an admin object', () => {
		expect(textClientField(operand).admin).toEqual({})
		expect(numberClientField(operand).admin).toEqual({})
		expect(dateClientField(operand).admin).toEqual({})
		expect(selectClientField(operand).admin).toEqual({})
	})

	it('carries name, label, and type onto each leaf', () => {
		expect(textClientField(operand)).toMatchObject({
			name: 'country',
			label: 'Country',
			type: 'text',
		})
		expect(numberClientField(operand)).toMatchObject({ name: 'country', type: 'number' })
		expect(dateClientField(operand)).toMatchObject({ name: 'country', type: 'date' })
		expect(selectClientField(operand)).toMatchObject({ name: 'country', type: 'select' })
	})

	it('passes select options through, defaulting to an empty list', () => {
		expect(selectClientField(operand).options).toEqual([{ label: 'US', value: 'us' }])
		expect(selectClientField({ ...operand, options: undefined }).options).toEqual([])
	})
})
