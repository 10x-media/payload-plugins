import { describe, expect, it } from 'vitest'

import { computeSaveGuard } from './guard'

describe('computeSaveGuard', () => {
	it('allows a save on the last step under final-step', () => {
		expect(
			computeSaveGuard({
				blockedMessage: null,
				finished: false,
				isLast: true,
				readOnly: false,
				save: 'final-step',
			})
		).toEqual({ allowed: true, reason: null })
	})

	it('refuses before the last step under final-step and allows anywhere under always', () => {
		expect(
			computeSaveGuard({
				blockedMessage: null,
				finished: false,
				isLast: false,
				readOnly: false,
				save: 'final-step',
			})
		).toEqual({ allowed: false, reason: 'not-final-step' })
		expect(
			computeSaveGuard({
				blockedMessage: null,
				finished: false,
				isLast: false,
				readOnly: false,
				save: 'always',
			})
		).toEqual({ allowed: true, reason: null })
	})

	it('lets a step block saving regardless of position', () => {
		expect(
			computeSaveGuard({
				blockedMessage: 'duplicate',
				finished: false,
				isLast: true,
				readOnly: false,
				save: 'always',
			})
		).toEqual({ allowed: false, reason: 'blocked' })
	})

	it('refuses on a read-only document before anything else', () => {
		expect(
			computeSaveGuard({
				blockedMessage: 'x',
				finished: true,
				isLast: true,
				readOnly: true,
				save: 'always',
			})
		).toEqual({ allowed: false, reason: 'read-only' })
	})

	it('refuses once the wizard has ended with an outcome', () => {
		expect(
			computeSaveGuard({
				blockedMessage: null,
				finished: true,
				isLast: true,
				readOnly: false,
				save: 'always',
			})
		).toEqual({ allowed: false, reason: 'finished' })
	})
})
