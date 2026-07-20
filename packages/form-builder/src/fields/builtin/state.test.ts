import { describe, expect, it } from 'vitest'
import { US_STATES } from '../data/regions'
import { stateField } from './state'

const t = (key: string) => key
const base = { config: {}, siblingData: {}, data: {}, locale: 'en', t }

describe('stateField', () => {
	it('is a text-valued field with no author-facing options config', () => {
		expect(stateField.value).toBe('text')
		expect(stateField.config ?? []).toEqual([])
	})

	it('declares poll eligibility and resolves the fixed dataset as poll options', () => {
		expect(stateField.pollEligible).toBe(true)
		const options = stateField.resolveOptions?.({
			instance: { blockType: 'state', name: 'state' },
			form: { id: 1 },
			payload: {} as never,
		})
		expect(options).toBe(US_STATES)
	})

	it('accepts a known US state code', () => {
		expect(stateField.validate?.({ value: 'CA', ...base })).toBe(true)
	})

	it('rejects an unknown code', () => {
		expect(stateField.validate?.({ value: 'ZZ', ...base })).toBe('formBuilder:validation.state')
	})

	it('accepts an empty value (required is enforced by the engine)', () => {
		expect(stateField.validate?.({ value: '', ...base })).toBe(true)
		expect(stateField.validate?.({ value: null, ...base })).toBe(true)
	})

	it('formats a code to its state name', () => {
		expect(stateField.format?.({ value: 'NY', ...base })).toBe('New York')
	})

	it('falls back to the raw value for an unknown code and empty for none', () => {
		expect(stateField.format?.({ value: 'ZZ', ...base })).toBe('ZZ')
		expect(stateField.format?.({ value: '', ...base })).toBe('')
	})
})
