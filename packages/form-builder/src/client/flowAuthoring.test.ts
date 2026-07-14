import { describe, expect, it } from 'vitest'
import type { FlowStep } from '../flow/types'
import {
	assignFieldToStep,
	fieldHolders,
	removeFieldFromStep,
	stepLabel,
	unassignedFields,
} from './flowAuthoring'

const step = (id: string, fields: string[], title?: string): FlowStep => ({ id, fields, title })

describe('stepLabel', () => {
	it('returns the trimmed title when present', () => {
		expect(stepLabel({ title: '  Contact  ' }, 0, 'Step {n}')).toBe('Contact')
	})
	it('falls back to the template with a 1-based index', () => {
		expect(stepLabel({}, 0, 'Step {n}')).toBe('Step 1')
		expect(stepLabel({ title: '   ' }, 2, 'Step {n}')).toBe('Step 3')
	})
})

describe('fieldHolders', () => {
	it('maps each field to the first step that holds it', () => {
		const holders = fieldHolders([step('a', ['name']), step('b', ['name', 'email'])])
		expect(holders.get('name')).toBe(0)
		expect(holders.get('email')).toBe(1)
		expect(holders.get('ghost')).toBeUndefined()
	})
})

describe('unassignedFields', () => {
	it('lists fields missing from every step, in form order', () => {
		const steps = [step('a', ['email']), step('b', [])]
		expect(unassignedFields(['name', 'email', 'age'], steps)).toEqual(['name', 'age'])
	})
	it('returns all fields when there are no steps', () => {
		expect(unassignedFields(['name'], [])).toEqual(['name'])
	})
})

describe('assignFieldToStep', () => {
	it('adds the field to the target step and strips it from every other step', () => {
		const steps = [step('a', ['name', 'email']), step('b', ['x'])]
		const next = assignFieldToStep(steps, 1, 'email')
		expect(next[0]?.fields).toEqual(['name'])
		expect(next[1]?.fields).toEqual(['x', 'email'])
	})
	it('does not duplicate a field already in the target step', () => {
		const steps = [step('a', ['name'])]
		expect(assignFieldToStep(steps, 0, 'name')[0]?.fields).toEqual(['name'])
	})
	it('does not mutate the input steps', () => {
		const steps = [step('a', ['name']), step('b', [])]
		assignFieldToStep(steps, 1, 'name')
		expect(steps[0]?.fields).toEqual(['name'])
		expect(steps[1]?.fields).toEqual([])
	})
})

describe('removeFieldFromStep', () => {
	it('removes the field from the target step only', () => {
		const steps = [step('a', ['name']), step('b', ['name'])]
		const next = removeFieldFromStep(steps, 0, 'name')
		expect(next[0]?.fields).toEqual([])
		expect(next[1]?.fields).toEqual(['name'])
	})
})
