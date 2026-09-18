import { describe, expect, it } from 'vitest'
import { clientIpFromHeaders } from './clientIp'

const headers = (init: Record<string, string>) => new Headers(init)

describe('clientIpFromHeaders', () => {
	it('takes the first hop of x-forwarded-for', () => {
		expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' }))).toBe(
			'9.9.9.9'
		)
	})

	it('trims surrounding whitespace', () => {
		expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '  9.9.9.9 , 10.0.0.1' }))).toBe(
			'9.9.9.9'
		)
	})

	it('falls back to x-real-ip', () => {
		expect(clientIpFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
	})

	it('falls back to x-real-ip when x-forwarded-for is present but empty', () => {
		expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '', 'x-real-ip': '8.8.8.8' }))).toBe(
			'8.8.8.8'
		)
	})

	it('returns null when neither header is present', () => {
		expect(clientIpFromHeaders(headers({ 'user-agent': 'x' }))).toBeNull()
	})

	it('returns null rather than an empty string for blank values', () => {
		expect(clientIpFromHeaders(headers({ 'x-forwarded-for': ' , ', 'x-real-ip': '  ' }))).toBeNull()
	})

	it('keeps the leftmost entry at zero trusted hops', () => {
		const h = headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 10.0.0.2' })
		expect(clientIpFromHeaders(h, {})).toBe('9.9.9.9')
		expect(clientIpFromHeaders(h, { trustedProxyHops: 0 })).toBe('9.9.9.9')
	})

	it('counts trusted hops from the right', () => {
		const h = headers({ 'x-forwarded-for': 'spoofed, 9.9.9.9, 10.0.0.1, 10.0.0.2' })
		expect(clientIpFromHeaders(h, { trustedProxyHops: 1 })).toBe('10.0.0.2')
		expect(clientIpFromHeaders(h, { trustedProxyHops: 2 })).toBe('10.0.0.1')
		expect(clientIpFromHeaders(h, { trustedProxyHops: 3 })).toBe('9.9.9.9')
	})

	it('trims the counted entry and ignores blank ones', () => {
		expect(
			clientIpFromHeaders(headers({ 'x-forwarded-for': ' 9.9.9.9 , , 10.0.0.1 ' }), {
				trustedProxyHops: 2,
			})
		).toBe('9.9.9.9')
	})

	it('returns null when the chain is shorter than the trusted hop count', () => {
		expect(
			clientIpFromHeaders(headers({ 'x-forwarded-for': '9.9.9.9' }), { trustedProxyHops: 2 })
		).toBeNull()
		expect(clientIpFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }), { trustedProxyHops: 1 })).toBe(
			null
		)
	})
})
