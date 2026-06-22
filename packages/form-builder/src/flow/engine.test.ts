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
	it('resolveNextStepId falls back to the default next when no transition matches', () => {
		expect(resolveNextStepId(flow, 'a', { plan: 'free' })).toBe('basic')
	})
	it('a step with no next and no matching transition is terminal', () => {
		expect(resolveNextStepId(flow, 'done', {})).toBeUndefined()
		expect(isTerminalStepId(flow, 'done', {})).toBe(true)
		expect(isTerminalStepId(flow, 'a', { plan: 'free' })).toBe(false)
	})
	it('stepFieldNames returns the step field list', () => {
		expect(stepFieldNames(flow, 'a')).toEqual(['name'])
		expect(stepFieldNames(flow, 'missing')).toEqual([])
	})
})
