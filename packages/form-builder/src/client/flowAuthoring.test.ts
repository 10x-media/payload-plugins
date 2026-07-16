import { describe, expect, it } from 'vitest'
import type { FlowStep } from '../flow/types'
import {
	assignFieldToStep,
	END_OF_FORM,
	fieldHolders,
	flowFieldEntries,
	nextFromSelectValue,
	nextToSelectValue,
	removeFieldFromStep,
	removeStepCascade,
	unassignedEntries,
} from './flowAuthoring'

const step = (id: string, fields: string[], title?: string): FlowStep => ({ id, fields, title })

const entry = (key: string, label = key) => ({ key, label })

describe('flowFieldEntries', () => {
	const bareLabels = { message: 'Message' }

	it('keys and labels named rows by their trimmed name', () => {
		const entries = flowFieldEntries(
			[
				{ blockType: 'text', name: ' email ', id: 'r1' },
				{ blockType: 'number', name: 'age', id: 'r2' },
			],
			bareLabels
		)
		expect(entries).toEqual([entry('email'), entry('age')])
	})

	it('keys a bare row by its row id and labels it with the type label', () => {
		const entries = flowFieldEntries(
			[
				{ blockType: 'text', name: 'email', id: 'r1' },
				{ blockType: 'message', id: 'r2' },
			],
			bareLabels
		)
		expect(entries).toEqual([entry('email'), { key: 'r2', label: 'Message' }])
	})

	it('numbers bare labels in form order when the type occurs more than once', () => {
		const entries = flowFieldEntries(
			[
				{ blockType: 'message', id: 'r1' },
				{ blockType: 'text', name: 'email', id: 'r2' },
				{ blockType: 'message', id: 'r3' },
			],
			bareLabels
		)
		expect(entries).toEqual([
			{ key: 'r1', label: 'Message 1' },
			entry('email'),
			{ key: 'r3', label: 'Message 2' },
		])
	})

	it('prefers the name for a legacy bare row that still carries one', () => {
		const entries = flowFieldEntries([{ blockType: 'message', name: 'note', id: 'r1' }], bareLabels)
		expect(entries).toEqual([entry('note')])
	})

	it('skips nameless rows that are not a bare type and bare rows without an id', () => {
		const entries = flowFieldEntries(
			[
				{ blockType: 'text', id: 'r1' },
				{ blockType: 'text', name: '   ', id: 'r2' },
				{ blockType: 'message' },
			],
			bareLabels
		)
		expect(entries).toEqual([])
	})
})

describe('fieldHolders', () => {
	it('maps each field key to the first step that holds it', () => {
		const holders = fieldHolders([step('a', ['name']), step('b', ['name', 'email'])])
		expect(holders.get('name')).toBe(0)
		expect(holders.get('email')).toBe(1)
		expect(holders.get('ghost')).toBeUndefined()
	})
})

describe('unassignedEntries', () => {
	it('lists entries missing from every step, in form order', () => {
		const steps = [step('a', ['email']), step('b', [])]
		const entries = [entry('name'), entry('email'), entry('r1', 'Message')]
		expect(unassignedEntries(entries, steps)).toEqual([entry('name'), entry('r1', 'Message')])
	})
	it('returns all entries when there are no steps', () => {
		expect(unassignedEntries([entry('name')], [])).toEqual([entry('name')])
	})
})

describe('assignFieldToStep', () => {
	it('adds the key to the target step and strips it from every other step', () => {
		const steps = [step('a', ['name', 'email']), step('b', ['x'])]
		const next = assignFieldToStep(steps, 1, 'email')
		expect(next[0]?.fields).toEqual(['name'])
		expect(next[1]?.fields).toEqual(['x', 'email'])
	})
	it('does not duplicate a key already in the target step', () => {
		const steps = [step('a', ['name'])]
		expect(assignFieldToStep(steps, 0, 'name')[0]?.fields).toEqual(['name'])
	})
	it('does not mutate the input steps', () => {
		const steps = [step('a', ['name']), step('b', [])]
		assignFieldToStep(steps, 1, 'name')
		expect(steps[0]?.fields).toEqual(['name'])
		expect(steps[1]?.fields).toEqual([])
	})
	it('assigns a bare row id key like any other key', () => {
		const steps = [step('a', []), step('b', [])]
		const next = assignFieldToStep(steps, 1, 'r2')
		expect(next[1]?.fields).toEqual(['r2'])
	})
})

describe('removeFieldFromStep', () => {
	it('removes the key from the target step only', () => {
		const steps = [step('a', ['name']), step('b', ['name'])]
		const next = removeFieldFromStep(steps, 0, 'name')
		expect(next[0]?.fields).toEqual([])
		expect(next[1]?.fields).toEqual(['name'])
	})
})

describe('removeStepCascade', () => {
	it("drops another step's next pointing at the removed step, back to sequential", () => {
		const steps: FlowStep[] = [
			{ id: 'a', fields: [], next: 'b' },
			{ id: 'b', fields: [] },
			{ id: 'c', fields: [] },
		]
		const next = removeStepCascade(steps, 1)
		expect(next.map((s) => s.id)).toEqual(['a', 'c'])
		expect(next[0] ? 'next' in next[0] : undefined).toBe(false)
	})
	it('keeps next: null and next pointing at surviving steps', () => {
		const steps: FlowStep[] = [
			{ id: 'a', fields: [], next: null },
			{ id: 'b', fields: [], next: 'a' },
			{ id: 'c', fields: [] },
		]
		const next = removeStepCascade(steps, 2)
		expect(next[0]?.next).toBeNull()
		expect(next[1]?.next).toBe('a')
	})
	it('removes transitions targeting the removed step and drops the key when none remain', () => {
		const steps: FlowStep[] = [
			{
				id: 'a',
				fields: [],
				transitions: [
					{ when: { x: { equals: 1 } }, to: 'b' },
					{ when: { x: { equals: 2 } }, to: 'c' },
				],
			},
			{ id: 'b', fields: [], transitions: [{ when: { y: { equals: 1 } }, to: 'c' }] },
			{ id: 'c', fields: [] },
		]
		const next = removeStepCascade(steps, 2)
		expect(next[0]?.transitions).toEqual([{ when: { x: { equals: 1 } }, to: 'b' }])
		expect(next[1] ? 'transitions' in next[1] : undefined).toBe(false)
	})
	it('returns untouched steps by identity and ignores an unknown index', () => {
		const steps: FlowStep[] = [
			{ id: 'a', fields: [], next: 'c' },
			{ id: 'b', fields: [] },
			{ id: 'c', fields: [] },
		]
		expect(removeStepCascade(steps, 1)[0]).toBe(steps[0])
		expect(removeStepCascade(steps, 9)).toEqual(steps)
	})
})

describe('next select value mapping', () => {
	it('maps an absent next to the empty (sequential) option value and back', () => {
		expect(nextToSelectValue(undefined)).toBe('')
		expect(nextFromSelectValue('')).toBeUndefined()
	})
	it('maps next: null to the end-of-form sentinel and back', () => {
		expect(nextToSelectValue(null)).toBe(END_OF_FORM)
		expect(nextFromSelectValue(END_OF_FORM)).toBeNull()
	})
	it('passes a step id through unchanged in both directions', () => {
		expect(nextToSelectValue('step-1')).toBe('step-1')
		expect(nextFromSelectValue('step-1')).toBe('step-1')
	})
})
