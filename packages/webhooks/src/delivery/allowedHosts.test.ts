import { describe, expect, it } from 'vitest'
import { assertAllowedHosts, isAllowedHost } from './allowedHosts'

describe('assertAllowedHosts', () => {
	it('accepts bare hostnames, leading wildcards, addresses, and no list at all', () => {
		expect(() =>
			assertAllowedHosts(['hooks.example.com', '*.example.com', '127.0.0.1', '[::1]', 'localhost'])
		).not.toThrow()
		expect(() => assertAllowedHosts(undefined)).not.toThrow()
		expect(() => assertAllowedHosts([])).not.toThrow()
	})

	/**
	 * Each of these would match no hostname, so every subscription would be rejected with nothing
	 * to say that the list, not the URL, is what is wrong.
	 */
	it('refuses an entry that could never match a hostname', () => {
		const wrong = [
			'https://hooks.example.com',
			'hooks.example.com:8443',
			'hooks.example.com/',
			'hooks.example.com/hook',
			'*',
			'*.',
			'hooks.*.example.com',
			'::1',
			'',
		]
		for (const entry of wrong) {
			expect(() => assertAllowedHosts([entry]), entry).toThrow(/is not a hostname/)
		}
	})
})

describe('isAllowedHost', () => {
	/** No list is the default, and it has to keep localhost and private addresses usable. */
	it('allows every host when no list is configured', () => {
		expect(isAllowedHost('http://localhost:3000/hook', undefined)).toBe(true)
		expect(isAllowedHost('http://10.0.0.5/hook', undefined)).toBe(true)
	})

	it('matches an exact hostname, whatever the port or case', () => {
		const hosts = ['hooks.example.com']
		expect(isAllowedHost('https://hooks.example.com/a', hosts)).toBe(true)
		expect(isAllowedHost('https://HOOKS.Example.com:8443/a', hosts)).toBe(true)
		expect(isAllowedHost('https://other.example.com/a', hosts)).toBe(false)
	})

	it('matches any subdomain of a wildcard entry, but not the bare domain', () => {
		const hosts = ['*.example.com']
		expect(isAllowedHost('https://a.example.com', hosts)).toBe(true)
		expect(isAllowedHost('https://a.b.example.com', hosts)).toBe(true)
		expect(isAllowedHost('https://example.com', hosts)).toBe(false)
	})

	/** The suffix test must not be satisfiable by a host that merely ends with the same letters. */
	it('is not fooled by a lookalike suffix or a host smuggled into the path', () => {
		const hosts = ['*.example.com', 'hooks.example.com']
		expect(isAllowedHost('https://evilexample.com', hosts)).toBe(false)
		expect(isAllowedHost('https://hooks.example.com.evil.test', hosts)).toBe(false)
		expect(isAllowedHost('https://evil.test/hooks.example.com', hosts)).toBe(false)
		expect(isAllowedHost('https://hooks.example.com@evil.test', hosts)).toBe(false)
	})

	it('allows nothing for an empty list, and nothing that is not a url', () => {
		expect(isAllowedHost('https://hooks.example.com', [])).toBe(false)
		expect(isAllowedHost('not a url', ['hooks.example.com'])).toBe(false)
	})
})
