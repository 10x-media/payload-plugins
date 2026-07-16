import { describe, expect, it } from 'vitest'
import { stepLabel } from './stepLabel'

describe('stepLabel', () => {
	it('returns the trimmed title when present', () => {
		expect(stepLabel({ title: '  Contact  ' }, 0, 'Step {n}')).toBe('Contact')
	})
	it('falls back to the template with a 1-based index', () => {
		expect(stepLabel({}, 0, 'Step {n}')).toBe('Step 1')
		expect(stepLabel({ title: '   ' }, 2, 'Step {n}')).toBe('Step 3')
	})
})
