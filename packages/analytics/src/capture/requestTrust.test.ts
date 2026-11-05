import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	refusedCrossSite,
	resolveAllowedOrigins,
	UNTRUSTED_FORWARDING_WARNING,
	warnUntrustedForwarding,
} from './requestTrust'

describe('resolveAllowedOrigins', () => {
	it('is empty when unset', () => {
		expect(resolveAllowedOrigins(undefined).size).toBe(0)
	})

	it('normalizes each origin, a trailing slash included', () => {
		expect([
			...resolveAllowedOrigins([
				'https://Shop.Example.com/',
				'http://localhost:3000',
				'https://a.example:443',
			]),
		]).toEqual(['https://shop.example.com', 'http://localhost:3000', 'https://a.example'])
	})

	it.each([
		'https://shop.example.com/checkout',
		'https://shop.example.com?a=1',
		'https://shop.example.com/#x',
		'https://*.example.com',
		'https://user:pw@shop.example.com',
		'shop.example.com',
		'ftp://shop.example.com',
		'null',
		'',
	])('refuses %j, which is not one exact origin', (entry) => {
		expect(() => resolveAllowedOrigins([entry])).toThrow(/capture\.allowedOrigins entries/)
	})

	it('refuses a value that is not a list, and an entry that is not a string', () => {
		expect(() => resolveAllowedOrigins('https://shop.example.com')).toThrow(
			/must be a list of origins/
		)
		expect(() => resolveAllowedOrigins([42])).toThrow(/capture\.allowedOrigins entries/)
	})
})

describe('refusedCrossSite', () => {
	const allowed = resolveAllowedOrigins(['https://partner.example'])
	const request = (init: Record<string, string>) => new Headers(init)

	const table: Array<[name: string, headers: Record<string, string>, refused: boolean]> = [
		['same-origin', { 'sec-fetch-site': 'same-origin' }, false],
		['same-site', { 'sec-fetch-site': 'same-site', origin: 'https://evil.example' }, false],
		['none', { 'sec-fetch-site': 'none' }, false],
		['no fetch metadata at all', {}, false],
		[
			'cross-site from an unlisted origin',
			{ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
			true,
		],
		['cross-site with no origin', { 'sec-fetch-site': 'cross-site' }, true],
		['cross-site from an opaque origin', { 'sec-fetch-site': 'cross-site', origin: 'null' }, true],
		[
			'cross-site from a listed origin',
			{ 'sec-fetch-site': 'cross-site', origin: 'https://partner.example' },
			false,
		],
		[
			'cross-site from a listed origin, written differently',
			{ 'sec-fetch-site': 'Cross-Site', origin: 'https://PARTNER.example:443' },
			false,
		],
		[
			'cross-site from a subdomain of a listed origin',
			{ 'sec-fetch-site': 'cross-site', origin: 'https://www.partner.example' },
			true,
		],
	]

	for (const [name, headers, refused] of table) {
		it(`${refused ? 'refuses' : 'passes'} ${name}`, () => {
			expect(refusedCrossSite(request(headers), allowed)).toBe(refused)
		})
	}

	it('refuses every cross-site request while no origin is listed', () => {
		expect(
			refusedCrossSite(
				request({ 'sec-fetch-site': 'cross-site', origin: 'https://partner.example' }),
				new Set()
			)
		).toBe(true)
	})
})

describe('warnUntrustedForwarding', () => {
	const chain = new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })

	it('warns once per instance about a chain nothing vouches for', () => {
		const warn = vi.fn()
		const payload = { logger: { warn } } as unknown as Payload
		warnUntrustedForwarding(payload, chain, {})
		warnUntrustedForwarding(payload, chain, {})
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(UNTRUSTED_FORWARDING_WARNING)
		expect(UNTRUSTED_FORWARDING_WARNING).toMatch(/trustedProxyHops/)
		expect(UNTRUSTED_FORWARDING_WARNING).toMatch(/trustedPlatform/)
	})

	it('stays quiet for a single entry, and once the install trusts its proxies', () => {
		const warn = vi.fn()
		const payload = { logger: { warn } } as unknown as Payload
		warnUntrustedForwarding(payload, new Headers({ 'x-forwarded-for': '1.1.1.1' }), {})
		warnUntrustedForwarding(payload, chain, { trustedProxyHops: 2 })
		warnUntrustedForwarding(payload, chain, { trustedPlatform: 'vercel' })
		expect(warn).not.toHaveBeenCalled()
	})
})
