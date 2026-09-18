import { describe, expect, it } from 'vitest'
import { requestHostname } from './requestHost'

const headers = (init: Record<string, string>) => new Headers(init)

describe('requestHostname', () => {
	it('reads the Host header', () => {
		expect(requestHostname(headers({ host: 'a.example' }), {})).toBe('a.example')
	})

	it('ignores Origin even when it names another host', () => {
		expect(
			requestHostname(headers({ host: 'a.example', origin: 'https://evil.example' }), {})
		).toBe('a.example')
		expect(requestHostname(headers({ origin: 'https://evil.example' }), {})).toBeNull()
		expect(
			requestHostname(headers({ origin: 'https://evil.example' }), { trustedProxyHops: 1 })
		).toBeNull()
	})

	it('ignores x-forwarded-host until a proxy hop is trusted', () => {
		const h = headers({ host: 'a.example', 'x-forwarded-host': 'b.example' })
		expect(requestHostname(h, {})).toBe('a.example')
		expect(requestHostname(h, { trustedProxyHops: 0 })).toBe('a.example')
		expect(requestHostname(h, { trustedProxyHops: 1 })).toBe('b.example')
	})

	it('takes the first value of a comma-listed x-forwarded-host', () => {
		expect(
			requestHostname(headers({ 'x-forwarded-host': 'b.example, c.example' }), {
				trustedProxyHops: 1,
			})
		).toBe('b.example')
	})

	it('falls back to Host when a trusted proxy sent no forwarded host', () => {
		expect(requestHostname(headers({ host: 'a.example' }), { trustedProxyHops: 2 })).toBe(
			'a.example'
		)
	})

	it('lowercases and strips the port', () => {
		expect(requestHostname(headers({ host: 'A.Example:3000' }), {})).toBe('a.example')
	})

	it('keeps a bracketed IPv6 host and strips its port', () => {
		expect(requestHostname(headers({ host: '[::1]:3000' }), {})).toBe('[::1]')
		expect(requestHostname(headers({ host: '[2001:DB8::1]' }), {})).toBe('[2001:db8::1]')
	})

	it('strips the trailing root dot', () => {
		expect(requestHostname(headers({ host: 'a.example.:443' }), {})).toBe('a.example')
	})

	it('caps an over-long value at the longest legal DNS name', () => {
		const long = `${'a'.repeat(300)}.example`
		expect(requestHostname(headers({ host: long }), {})).toHaveLength(253)
	})

	it('answers null for an empty header set, a blank host, or a bare port', () => {
		expect(requestHostname(headers({}), {})).toBeNull()
		expect(requestHostname(headers({ host: '   ' }), {})).toBeNull()
		expect(requestHostname(headers({ host: ':3000' }), {})).toBeNull()
	})

	it('answers null for characters a hostname cannot carry', () => {
		expect(requestHostname(headers({ host: 'a.example/../b' }), {})).toBeNull()
		expect(requestHostname(headers({ host: 'user@a.example' }), {})).toBeNull()
		expect(requestHostname(headers({ host: 'a example' }), {})).toBeNull()
	})
})
