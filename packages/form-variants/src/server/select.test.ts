import { describe, expect, it } from 'vitest'

import { selectVariant } from './select'

describe('selectVariant', () => {
	const available = ['quick', 'native']

	it('prefers the query parameter, then the stored choice, then the default', () => {
		expect(
			selectVariant({ available, defaultKey: 'native', requested: 'quick', stored: 'native' })
		).toBe('quick')
		expect(selectVariant({ available, defaultKey: 'native', stored: 'quick' })).toBe('quick')
		expect(selectVariant({ available, defaultKey: 'native' })).toBe('native')
	})

	it('ignores a parameter or choice the account cannot access', () => {
		expect(selectVariant({ available: ['quick'], defaultKey: 'quick', requested: 'native' })).toBe(
			'quick'
		)
		expect(selectVariant({ available: ['quick'], defaultKey: 'quick', stored: 'native' })).toBe(
			'quick'
		)
	})

	it('falls back to the first available variant when nothing else applies', () => {
		expect(selectVariant({ available, defaultKey: 'ghost' })).toBe('quick')
		expect(selectVariant({ available })).toBe('quick')
	})

	it('answers null when no variant is available', () => {
		expect(selectVariant({ available: [], defaultKey: 'native', requested: 'native' })).toBeNull()
	})
})
