import { describe, expect, it } from 'vitest'
import { type FormState, formReducer, initialFormState } from './state'

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

	it('SET_FIELD_ISSUES stores errors + warnings for a field', () => {
		const next = formReducer(base, {
			type: 'SET_FIELD_ISSUES',
			name: 'a',
			errors: ['bad'],
			warnings: ['warn'],
		})
		expect(next.errors.a).toEqual(['bad'])
		expect(next.warnings.a).toEqual(['warn'])
	})

	it('SET_ALL_ISSUES replaces the whole error/warning maps and marks submitAttempted', () => {
		const next = formReducer(base, { type: 'SET_ALL_ISSUES', errors: { a: ['x'] }, warnings: {} })
		expect(next.errors).toEqual({ a: ['x'] })
		expect(next.submitAttempted).toBe(true)
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
			warnings: [],
		})
		const cleared = formReducer(withErr, { type: 'SET_VALUE', name: 'a', value: 'x' })
		expect(cleared.errors.a ?? []).toEqual([])
	})
})
