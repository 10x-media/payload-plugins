import { describe, expect, it } from 'vitest'

import { decideRecovery } from './recoveryDecision'

describe('decideRecovery', () => {
	it('requeues while below the cap', () => {
		expect(decideRecovery(0, 3)).toBe('requeue')
		expect(decideRecovery(2, 3)).toBe('requeue')
	})

	it('dead-letters at and above the cap', () => {
		expect(decideRecovery(3, 3)).toBe('deadLetter')
		expect(decideRecovery(4, 3)).toBe('deadLetter')
	})

	it('dead-letters immediately when the cap is zero', () => {
		expect(decideRecovery(0, 0)).toBe('deadLetter')
	})
})
