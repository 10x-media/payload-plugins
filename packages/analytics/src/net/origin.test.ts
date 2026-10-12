import { describe, expect, it } from 'vitest'
import { normalizeOrigin, parseOrigin } from './origin'

describe('parseOrigin', () => {
	it('normalizes an origin the way the browser does', () => {
		expect(parseOrigin('HTTPS://Analytics.Example.COM:443/', false)).toEqual({
			origin: 'https://analytics.example.com',
		})
		expect(parseOrigin(' https://bücher.example ', false)).toEqual({
			origin: 'https://xn--bcher-kva.example',
		})
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
	])('refuses %j, which is not one origin', (value) => {
		expect(parseOrigin(value, true)).toEqual({ problem: 'format' })
	})

	it('takes plain http only when told to', () => {
		expect(parseOrigin('http://localhost:3000', false)).toEqual({ problem: 'insecure' })
		expect(parseOrigin('http://localhost:3000', true)).toEqual({ origin: 'http://localhost:3000' })
	})
})

describe('normalizeOrigin', () => {
	it('writes an origin the way a browser sends it', () => {
		expect(normalizeOrigin('https://Shop.Example.com')).toBe('https://shop.example.com')
		expect(normalizeOrigin('https://shop.example.com:443')).toBe('https://shop.example.com')
		expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000')
		expect(normalizeOrigin(' https://bücher.example ')).toBe('https://xn--bcher-kva.example')
	})

	it('answers null for an opaque origin and anything that is not a web origin', () => {
		expect(normalizeOrigin('null')).toBeNull()
		expect(normalizeOrigin('')).toBeNull()
		expect(normalizeOrigin('ftp://example.com')).toBeNull()
		expect(normalizeOrigin('chrome-extension://abcdef')).toBeNull()
	})
})
