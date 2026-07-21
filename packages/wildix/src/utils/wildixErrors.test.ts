import { describe, expect, it } from 'vitest'
import { isRouteMissingError } from './wildixErrors'

describe('isRouteMissingError', () => {
	it('matches an SDK error with a 404 metadata status', () => {
		expect(isRouteMissingError({ $metadata: { httpStatusCode: 404 } })).toBe(true)
	})

	it('matches a "404 Not Found" message', () => {
		expect(isRouteMissingError(new Error('WmsApi: 404 Not Found'))).toBe(true)
	})

	it('ignores unrelated errors', () => {
		expect(isRouteMissingError(new Error('500 Internal Server Error'))).toBe(false)
		expect(isRouteMissingError({ $metadata: { httpStatusCode: 401 } })).toBe(false)
		expect(isRouteMissingError('boom')).toBe(false)
	})
})
