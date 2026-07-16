import { describe, expect, it } from 'vitest'
import { firstStepId, isTerminalStepId, resolveNextStepId, stepFieldNames } from './engine'
import type { FormFlow } from './types'

const flow: FormFlow = {
	steps: [
		{
			id: 'a',
			fields: ['name'],
			transitions: [{ when: { plan: { equals: 'pro' } }, to: 'pro' }],
			next: 'basic',
		},
		{ id: 'basic', fields: ['x'], next: 'done' },
		{ id: 'pro', fields: ['y'], next: 'done' },
		{ id: 'done', fields: ['email'] },
	],
}

describe('flow engine', () => {
	it('firstStepId is the first step', () => {
		expect(firstStepId(flow)).toBe('a')
	})
	it('resolveNextStepId follows the first matching transition', () => {
		expect(resolveNextStepId(flow, 'a', { plan: 'pro' })).toBe('pro')
	})
	it('resolveNextStepId falls back to the explicit next when no transition matches', () => {
		expect(resolveNextStepId(flow, 'a', { plan: 'free' })).toBe('basic')
		expect(isTerminalStepId(flow, 'a', { plan: 'free' })).toBe(false)
	})
	it('a step without next falls through to the next step in array order', () => {
		const sequential: FormFlow = {
			steps: [
				{ id: 'one', fields: ['name'] },
				{ id: 'two', fields: ['x'] },
				{ id: 'three', fields: ['email'] },
			],
		}
		expect(resolveNextStepId(sequential, 'one', {})).toBe('two')
		expect(resolveNextStepId(sequential, 'two', {})).toBe('three')
		expect(isTerminalStepId(sequential, 'two', {})).toBe(false)
	})
	it('the last step without next is terminal', () => {
		expect(resolveNextStepId(flow, 'done', {})).toBeUndefined()
		expect(isTerminalStepId(flow, 'done', {})).toBe(true)
	})
	it('next: null ends the form regardless of position', () => {
		const earlyEnd: FormFlow = {
			steps: [
				{ id: 'one', fields: ['name'], next: null },
				{ id: 'two', fields: ['email'] },
			],
		}
		expect(resolveNextStepId(earlyEnd, 'one', {})).toBeUndefined()
		expect(isTerminalStepId(earlyEnd, 'one', {})).toBe(true)
	})
	it('a matching transition wins over next: null and over fall-through', () => {
		const branching: FormFlow = {
			steps: [
				{
					id: 'one',
					fields: ['name'],
					transitions: [{ when: { name: { equals: 'jump' } }, to: 'three' }],
					next: null,
				},
				{
					id: 'two',
					fields: ['x'],
					transitions: [{ when: { x: { equals: 'jump' } }, to: 'one' }],
				},
				{ id: 'three', fields: ['email'] },
			],
		}
		expect(resolveNextStepId(branching, 'one', { name: 'jump' })).toBe('three')
		expect(resolveNextStepId(branching, 'one', {})).toBeUndefined()
		expect(resolveNextStepId(branching, 'two', { x: 'jump' })).toBe('one')
		expect(resolveNextStepId(branching, 'two', {})).toBe('three')
	})
	it('an unknown current step id resolves to terminal', () => {
		expect(resolveNextStepId(flow, 'missing', {})).toBeUndefined()
		expect(isTerminalStepId(flow, 'missing', {})).toBe(true)
	})
	it('stepFieldNames returns the step field list', () => {
		expect(stepFieldNames(flow, 'a')).toEqual(['name'])
		expect(stepFieldNames(flow, 'missing')).toEqual([])
	})
})
