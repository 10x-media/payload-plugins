import { describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { type FormState, formReducer, initialFormState, seedFieldValues } from './state'

const base: FormState = initialFormState({ a: '', b: 0 })

describe('formReducer', () => {
	it('SET_VALUE updates a field value', () => {
		const next = formReducer(base, { type: 'SET_VALUE', name: 'a', value: 'hi' })
		expect(next.values.a).toBe('hi')
	})

	it('TOUCH marks a field touched', () => {
		const next = formReducer(base, { type: 'TOUCH', name: 'a' })
		expect(next.touched.a).toBe(true)
	})

	it('SET_FIELD_ISSUES stores errors for a field', () => {
		const next = formReducer(base, {
			type: 'SET_FIELD_ISSUES',
			name: 'a',
			errors: ['bad'],
		})
		expect(next.errors.a).toEqual(['bad'])
	})

	it('SET_ALL_ISSUES replaces the error map and records the attempted steps (never a global flag)', () => {
		const next = formReducer(base, {
			type: 'SET_ALL_ISSUES',
			errors: { a: ['x'] },
			steps: ['s1', 's2'],
		})
		expect(next.errors).toEqual({ a: ['x'] })
		expect([...next.attemptedSteps]).toEqual(['s1', 's2'])
	})

	it('SET_ALL_ISSUES with no steps clears errors without attempting a new step', () => {
		const attempted = formReducer(base, {
			type: 'SET_ALL_ISSUES',
			errors: { a: ['x'] },
			steps: ['s1'],
		})
		const cleared = formReducer(attempted, { type: 'SET_ALL_ISSUES', errors: {}, steps: [] })
		expect(cleared.errors).toEqual({})
		expect([...cleared.attemptedSteps]).toEqual(['s1'])
	})

	it('MARK_STEP_ATTEMPTED adds one step and is idempotent', () => {
		const once = formReducer(base, { type: 'MARK_STEP_ATTEMPTED', stepId: 's1' })
		expect([...once.attemptedSteps]).toEqual(['s1'])
		expect(formReducer(once, { type: 'MARK_STEP_ATTEMPTED', stepId: 's1' })).toBe(once)
	})

	it('RESET clears the attempted steps', () => {
		const attempted = formReducer(base, { type: 'MARK_STEP_ATTEMPTED', stepId: 's1' })
		const reset = formReducer(attempted, { type: 'RESET', values: { a: '' } })
		expect([...reset.attemptedSteps]).toEqual([])
	})

	it('SUBMIT_START / SUBMIT_SUCCESS / SUBMIT_ERROR move the submit lifecycle', () => {
		const starting = formReducer(base, { type: 'SUBMIT_START' })
		expect(starting.submitting).toBe(true)
		const ok = formReducer(starting, { type: 'SUBMIT_SUCCESS' })
		expect(ok.submitting).toBe(false)
		expect(ok.submitted).toBe(true)
		const err = formReducer(starting, { type: 'SUBMIT_ERROR', message: 'network' })
		expect(err.submitting).toBe(false)
		expect(err.submitError).toBe('network')
	})

	it('clears a field error when its value changes', () => {
		const withErr = formReducer(base, {
			type: 'SET_FIELD_ISSUES',
			name: 'a',
			errors: ['bad'],
		})
		const cleared = formReducer(withErr, { type: 'SET_VALUE', name: 'a', value: 'x' })
		expect(cleared.errors.a ?? []).toEqual([])
	})
})

describe('seedFieldValues', () => {
	it('seeds a repeater with a positive minRows as that many empty rows', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'repeater', name: 'members', minRows: 2, subFields: [] },
		]
		expect(seedFieldValues(fields)).toEqual({ members: [{}, {}] })
	})

	it('leaves a repeater with no minRows (or minRows 0) undefined', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'repeater', name: 'a', subFields: [] },
			{ blockType: 'repeater', name: 'b', minRows: 0, subFields: [] },
		]
		expect(seedFieldValues(fields)).toEqual({ a: undefined, b: undefined })
	})

	it('leaves every non-repeater field undefined', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name' },
			{ blockType: 'number', name: 'age' },
		]
		expect(seedFieldValues(fields)).toEqual({ name: undefined, age: undefined })
	})

	it('skips nameless (bare) blocks entirely', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'message', id: 'row-1', content: {} },
			{ blockType: 'text', name: 'name' },
		]
		const seeded = seedFieldValues(fields)
		expect(seeded).toEqual({ name: undefined })
		expect(Object.keys(seeded)).toEqual(['name'])
	})
})
