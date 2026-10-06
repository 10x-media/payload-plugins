import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { getClientIP, getUserAgent } from './request'

const req = (headers: Record<string, string>): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

describe('getClientIP', () => {
	it('takes the first hop of x-forwarded-for, which is the client', () => {
		expect(getClientIP(req({ 'x-forwarded-for': '203.0.113.1, 70.41.3.18' }))).toBe('203.0.113.1')
	})

	it('trims the whitespace proxies leave behind', () => {
		expect(getClientIP(req({ 'x-forwarded-for': '  203.0.113.1  ' }))).toBe('203.0.113.1')
	})

	it('falls back to x-real-ip', () => {
		expect(getClientIP(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
	})

	it('prefers x-forwarded-for when both are present', () => {
		expect(getClientIP(req({ 'x-forwarded-for': '203.0.113.1', 'x-real-ip': '203.0.113.9' }))).toBe(
			'203.0.113.1'
		)
	})

	it('is undefined when neither header is set', () => {
		expect(getClientIP(req({}))).toBeUndefined()
	})
})

describe('getUserAgent', () => {
	it('returns the header', () => {
		expect(getUserAgent(req({ 'user-agent': 'curl/8.0' }))).toBe('curl/8.0')
	})

	it('is undefined when absent', () => {
		expect(getUserAgent(req({}))).toBeUndefined()
	})
})
