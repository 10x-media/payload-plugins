import { describe, expect, it } from 'vitest'
import { isHostname, normalizeHostname, requestHostname } from './requestHost'

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

	it('counts a comma-listed x-forwarded-host from the trusted end', () => {
		expect(
			requestHostname(headers({ 'x-forwarded-host': 'b.example, c.example' }), {
				trustedProxyHops: 1,
			})
		).toBe('c.example')
	})

	it('stores the proxy value rather than the client one it was appended to', () => {
		expect(
			requestHostname(
				headers({ host: 'proxy.internal', 'x-forwarded-host': 'evil.example, real.example' }),
				{ trustedProxyHops: 1 }
			)
		).toBe('real.example')
	})

	it('counts back two entries at two trusted hops', () => {
		expect(
			requestHostname(
				headers({ 'x-forwarded-host': 'evil.example, outer.example, inner.example' }),
				{ trustedProxyHops: 2 }
			)
		).toBe('outer.example')
	})

	it('falls back to Host when a trusted proxy sent no forwarded host', () => {
		expect(requestHostname(headers({ host: 'a.example' }), { trustedProxyHops: 2 })).toBe(
			'a.example'
		)
	})

	it('falls back to Host when the forwarded chain is shorter than the trusted count', () => {
		expect(
			requestHostname(headers({ host: 'a.example', 'x-forwarded-host': 'b.example' }), {
				trustedProxyHops: 2,
			})
		).toBe('a.example')
	})

	it('falls back to Host when the entry at the trusted hop is not a hostname', () => {
		expect(
			requestHostname(headers({ host: 'a.example', 'x-forwarded-host': 'b.example, not a host' }), {
				trustedProxyHops: 1,
			})
		).toBe('a.example')
	})

	it('lowercases and strips the port', () => {
		expect(requestHostname(headers({ host: 'A.Example:3000' }), {})).toBe('a.example')
	})

	it('unwraps a bracketed IPv6 host and strips its port', () => {
		expect(requestHostname(headers({ host: '[::1]:3000' }), {})).toBe('::1')
		expect(requestHostname(headers({ host: '[2001:DB8::1]' }), {})).toBe('2001:db8::1')
	})

	it('refuses an unclosed bracket rather than storing it as its own host', () => {
		expect(requestHostname(headers({ host: '[::1' }), {})).toBeNull()
		expect(requestHostname(headers({ host: '[::1]junk' }), {})).toBeNull()
		expect(requestHostname(headers({ host: '::1]' }), {})).toBeNull()
	})

	it('refuses an over-long value rather than truncating it into a new host', () => {
		expect(requestHostname(headers({ host: `${'a'.repeat(300)}.example` }), {})).toBeNull()
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

// Each distinct stored hostname starts a rollup bucket family, and nothing prunes those, so a
// spelling this collapses is a write an unauthenticated client cannot repeat for free.
describe('normalizeHostname spellings', () => {
	it('collapses case, port and every trailing dot onto one hostname', () => {
		for (const spelling of [
			'a.example',
			'A.Example',
			'a.example.',
			'a.example..',
			'a.example...',
			'a.example:3000',
			'A.EXAMPLE.:443',
			'  a.example  ',
		]) {
			expect(normalizeHostname(spelling), spelling).toBe('a.example')
		}
	})

	it('refuses a leading or doubled dot, which name no host at all', () => {
		for (const spelling of ['.a.example', 'a..example', '.', '..']) {
			expect(normalizeHostname(spelling), spelling).toBeNull()
		}
	})

	it('refuses a percent-encoded or non-ASCII spelling of a name', () => {
		for (const spelling of ['a%2eexample', '%61.example', 'ä.example', 'a.example​']) {
			expect(normalizeHostname(spelling), spelling).toBeNull()
		}
	})

	it('refuses a port that is not a port', () => {
		expect(normalizeHostname('a.example:port')).toBeNull()
		expect(normalizeHostname('a.example:')).toBeNull()
	})

	it('keeps an IPv4 literal, which is already a dot-separated name', () => {
		expect(normalizeHostname('203.0.113.7:8080')).toBe('203.0.113.7')
	})
})

describe('isHostname', () => {
	it('accepts a single label, a dotted name and an IPv6 literal', () => {
		expect(isHostname('localhost')).toBe(true)
		expect(isHostname('alpha.localhost')).toBe(true)
		expect(isHostname('a_b-c.example')).toBe(true)
		expect(isHostname('::1')).toBe(true)
	})

	it('refuses free text, a scheme, a port and anything over the DNS cap', () => {
		expect(isHostname('')).toBe(false)
		expect(isHostname('tenant 7')).toBe(false)
		expect(isHostname('https://a.example')).toBe(false)
		expect(isHostname('a.example:3000')).toBe(false)
		expect(isHostname('A.example')).toBe(false)
		expect(isHostname(`${'a'.repeat(254)}`)).toBe(false)
	})
})
