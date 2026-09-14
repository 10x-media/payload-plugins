import type { FormState } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	resolveStepKey,
	stepErrorCount,
	stepIsRenderable,
	stepIsValid,
	stepPaths,
	visibleSteps,
} from './steps'
import type { ClientStep } from './types'

const step = (
	key: string,
	items: ClientStep['items'],
	kind: ClientStep['kind'] = 'fields'
): ClientStep => ({
	hasCondition: false,
	hasGate: false,
	initiallyVisible: true,
	items,
	key,
	kind,
})

const identity = step('identity', [
	{ path: 'firstName', type: 'field' },
	{ path: 'address', type: 'field' },
])
const secret = step('secret', [{ path: 'salary', type: 'field' }])
const component = step('check', [], 'component')

describe('stepIsRenderable', () => {
	it('needs one listed path in form state, prefix-matched', () => {
		expect(stepIsRenderable(identity, ['address.city'])).toBe(true)
		expect(stepIsRenderable(identity, ['lastName'])).toBe(false)
		expect(stepIsRenderable(secret, [])).toBe(false)
	})

	it('always renders component steps and steps with component items', () => {
		expect(stepIsRenderable(component, [])).toBe(true)
		expect(stepIsRenderable(step('mixed', [{ id: 'x', type: 'component' }]), [])).toBe(true)
	})
})

describe('visibleSteps and resolveStepKey', () => {
	const steps = [identity, secret, component]

	it('keeps config order and drops steps that are hidden or have nothing to render', () => {
		const visible = visibleSteps(
			steps,
			new Set(['identity', 'secret', 'check']),
			new Set(['identity', 'check'])
		)
		expect(visible.map((s) => s.key)).toEqual(['identity', 'check'])
	})

	it('opens the requested step when visible, else the first', () => {
		expect(resolveStepKey([identity, component], 'check')).toBe('check')
		expect(resolveStepKey([identity, component], 'secret')).toBe('identity')
		expect(resolveStepKey([], 'identity')).toBeNull()
	})
})

describe('stepPaths and stepIsValid', () => {
	const state: FormState = {
		'address.city': { valid: false, value: '' },
		'address.street': { valid: true, value: 'x' },
		firstName: { valid: true, value: 'Ada' },
		salary: { valid: false, value: null },
	}

	it('prefix-matches nested paths', () => {
		expect(stepPaths(identity, state).sort()).toEqual([
			'address.city',
			'address.street',
			'firstName',
		])
	})

	it('counts every failing field of the step, for the progress badge', () => {
		const both = step('both', [
			{ path: 'address', type: 'field' },
			{ path: 'salary', type: 'field' },
		])
		expect(stepErrorCount(both, state)).toBe(2)
		expect(stepErrorCount(identity, state)).toBe(1)
		expect(stepErrorCount(step('names', [{ path: 'firstName', type: 'field' }]), state)).toBe(0)
	})

	it('judges only the step, ignoring fields whose condition failed', () => {
		expect(stepIsValid(identity, state)).toBe(false)
		expect(stepIsValid(step('names', [{ path: 'firstName', type: 'field' }]), state)).toBe(true)
		expect(
			stepIsValid(identity, {
				...state,
				'address.city': { passesCondition: false, valid: false, value: '' },
			})
		).toBe(true)
	})
})
