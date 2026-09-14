import { describe, expect, it } from 'vitest'

import { resolveSlot } from './slots'

describe('resolveSlot', () => {
	it('takes the most specific level that sets the slot', () => {
		expect(
			resolveSlot('Progress', [undefined, { Progress: 'variant' }, { Progress: 'plugin' }])
		).toBe('variant')
	})

	it('lets false at a specific level hide what a broader level sets', () => {
		expect(resolveSlot('Navigation', [{ Navigation: false }, { Navigation: 'plugin' }])).toBe(false)
	})

	it('answers undefined when no level sets it, so the built-in renders', () => {
		expect(resolveSlot('StepHeader', [{}, undefined, { Progress: false }])).toBeUndefined()
	})
})
