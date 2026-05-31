import { describe, expect, it } from 'vitest'

import { extractErrorMessage } from './extractErrorMessage'

describe('extractErrorMessage', () => {
	it('returns a string error as-is', () => {
		expect(extractErrorMessage('boom')).toBe('boom')
	})

	it('prefers an object message', () => {
		expect(extractErrorMessage({ message: 'ECONNREFUSED' })).toBe('ECONNREFUSED')
	})

	it('falls back to the error name', () => {
		expect(extractErrorMessage({ name: 'TimeoutError' })).toBe('TimeoutError')
	})

	it('labels a cancellation', () => {
		expect(extractErrorMessage({ cancelled: true })).toBe('Cancelled')
	})

	it('returns undefined for missing or shapeless errors', () => {
		expect(extractErrorMessage(undefined)).toBeUndefined()
		expect(extractErrorMessage(null)).toBeUndefined()
		expect(extractErrorMessage('')).toBeUndefined()
		expect(extractErrorMessage({})).toBeUndefined()
	})
})
