import { describe, expect, it } from 'vitest'
import {
	type ClientIpOptions,
	clientIpFromHeaders,
	forwardedUntrusted,
	overlayClientIp,
} from './clientIp'

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

/** One request carrying every address header a client could write, each naming a different host. */
const everyAddress = () =>
	headers({
		'x-forwarded-for': '1.1.1.1, 2.2.2.2',
		'x-real-ip': '3.3.3.3',
		'cf-connecting-ip': '4.4.4.4',
	})

describe('clientIpFromHeaders under a trusted platform', () => {
	const table: Array<[name: string, opts: ClientIpOptions, expected: string | null]> = [
		['vercel reads x-real-ip, which its edge sets', { trustedPlatform: 'vercel' }, '3.3.3.3'],
		[
			'cloudflare reads cf-connecting-ip, which its edge sets',
			{ trustedPlatform: 'cloudflare' },
			'4.4.4.4',
		],
		['no trust keeps the leftmost forwarded entry', {}, '1.1.1.1'],
		['trusted hops count from the right', { trustedProxyHops: 1 }, '2.2.2.2'],
	]
	for (const [name, opts, expected] of table) {
		it(name, () => {
			expect(clientIpFromHeaders(everyAddress(), opts)).toBe(expected)
		})
	}

	it('never reads a platform header without that platform, however it is spelled', () => {
		expect(clientIpFromHeaders(headers({ 'cf-connecting-ip': '4.4.4.4' }))).toBeNull()
		expect(
			clientIpFromHeaders(headers({ 'cf-connecting-ip': '4.4.4.4' }), { trustedPlatform: 'vercel' })
		).toBeNull()
	})

	it('answers null rather than a forwarded entry when the platform header is missing', () => {
		expect(
			clientIpFromHeaders(headers({ 'x-forwarded-for': '1.1.1.1' }), { trustedPlatform: 'vercel' })
		).toBeNull()
		expect(
			clientIpFromHeaders(headers({ 'cf-connecting-ip': '  ' }), { trustedPlatform: 'cloudflare' })
		).toBeNull()
	})
})

describe('forwardedUntrusted', () => {
	it('is true for two or more forwarded entries with nothing trusted', () => {
		expect(forwardedUntrusted(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }), {})).toBe(true)
		expect(
			forwardedUntrusted(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }), {
				trustedProxyHops: 0,
			})
		).toBe(true)
	})

	it('is false for a single entry, or once either trust option is set', () => {
		expect(forwardedUntrusted(headers({ 'x-forwarded-for': '1.1.1.1' }), {})).toBe(false)
		expect(forwardedUntrusted(headers({ 'x-forwarded-for': ' , 1.1.1.1' }), {})).toBe(false)
		const chain = headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })
		expect(forwardedUntrusted(chain, { trustedProxyHops: 1 })).toBe(false)
		expect(forwardedUntrusted(chain, { trustedPlatform: 'cloudflare' })).toBe(false)
	})
})

describe('overlayClientIp', () => {
	const trusts: Array<[name: string, opts: ClientIpOptions]> = [
		['no trust', {}],
		['one trusted hop', { trustedProxyHops: 1 }],
		['three trusted hops', { trustedProxyHops: 3 }],
		['vercel', { trustedPlatform: 'vercel' }],
		['cloudflare', { trustedPlatform: 'cloudflare' }],
	]
	for (const [name, opts] of trusts) {
		it(`writes the address where ${name} reads it`, () => {
			expect(clientIpFromHeaders(overlayClientIp(everyAddress(), '9.9.9.9', opts), opts)).toBe(
				'9.9.9.9'
			)
		})
	}

	it("drops the platforms' location headers, which describe the replaced address", () => {
		const overlaid = overlayClientIp(
			headers({ 'cf-ipcountry': 'DE', 'x-vercel-ip-country': 'US', 'user-agent': 'UA' }),
			'9.9.9.9',
			{ trustedPlatform: 'cloudflare' }
		)
		expect(overlaid.get('cf-ipcountry')).toBeNull()
		expect(overlaid.get('x-vercel-ip-country')).toBeNull()
		expect(overlaid.get('user-agent')).toBe('UA')
	})
})
