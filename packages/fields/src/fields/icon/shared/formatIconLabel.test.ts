import { describe, expect, it } from 'vitest'
import { formatIconLabel } from './formatIconLabel'

describe('formatIconLabel', () => {
	it('sentence-cases a multi-word kebab name', () => {
		expect(formatIconLabel('align-horizontal-distribute-center')).toBe(
			'Align horizontal distribute center'
		)
	})

	it('capitalizes a single word', () => {
		expect(formatIconLabel('ambulance')).toBe('Ambulance')
	})

	it('lowercases every letter after the first', () => {
		expect(formatIconLabel('Arrow-Up-RIGHT')).toBe('Arrow up right')
	})

	it('collapses repeated and edge separators', () => {
		expect(formatIconLabel('--arrow--up--')).toBe('Arrow up')
	})

	it('returns an empty string for empty input', () => {
		expect(formatIconLabel('')).toBe('')
		expect(formatIconLabel('   ')).toBe('')
	})
})
