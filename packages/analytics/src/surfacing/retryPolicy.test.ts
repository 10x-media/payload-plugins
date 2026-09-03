import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import { shouldRetryProviderError } from './retryPolicy'

describe('shouldRetryProviderError', () => {
	it('retries a 429 twice then stops', () => {
		const err = new ProviderHttpError(429, 'ga4', 'rate limited')
		expect(shouldRetryProviderError(err, 0)).toBe(true)
		expect(shouldRetryProviderError(err, 1)).toBe(true)
		expect(shouldRetryProviderError(err, 2)).toBe(false)
	})

	it('retries a 500 twice then stops', () => {
		const err = new ProviderHttpError(500, 'ga4', 'server error')
		expect(shouldRetryProviderError(err, 0)).toBe(true)
		expect(shouldRetryProviderError(err, 1)).toBe(true)
		expect(shouldRetryProviderError(err, 2)).toBe(false)
	})

	it('never retries a 400', () => {
		const err = new ProviderHttpError(400, 'ga4', 'bad request')
		expect(shouldRetryProviderError(err, 0)).toBe(false)
	})

	it('never retries an abort', () => {
		const err = new Error('aborted')
		err.name = 'AbortError'
		expect(shouldRetryProviderError(err, 0)).toBe(false)
	})

	it('never retries the engine timeout abort reason', () => {
		const err = new Error('analytics: provider read timed out')
		expect(shouldRetryProviderError(err, 0)).toBe(false)
	})

	it('retries an unclassified network failure once', () => {
		const err = new TypeError('fetch failed')
		expect(shouldRetryProviderError(err, 0)).toBe(true)
		expect(shouldRetryProviderError(err, 1)).toBe(false)
	})
})
