import { describe, expect, it } from 'vitest'
import { siteAddress } from '../core/siteAddress'
import { exclusionQuery, exclusionUrl, readExclusionResponse, siteName } from './exclusionLink'

const link = { param: 'analytics_exclude', token: 'abc_DEF-123' }

describe('exclusionQuery', () => {
	it("is the part to add to the site's address where the install names no site", () => {
		expect(exclusionQuery(link)).toBe('?analytics_exclude=abc_DEF-123')
	})

	it('names the parameter the install chose', () => {
		expect(exclusionQuery({ ...link, param: 'staff.out' })).toBe('?staff.out=abc_DEF-123')
	})
})

describe('exclusionUrl', () => {
	it("is the site's address with the parameter set", () => {
		expect(exclusionUrl('https://shop.example.com/', link)).toBe(
			'https://shop.example.com/?analytics_exclude=abc_DEF-123'
		)
	})

	it('keeps a path, and a query the address already had', () => {
		expect(exclusionUrl('https://example.com/de?lang=de', link)).toBe(
			'https://example.com/de?lang=de&analytics_exclude=abc_DEF-123'
		)
	})
})

describe('siteName', () => {
	it('is the host, with the path past the root', () => {
		expect(siteName('https://shop.example.com/')).toBe('shop.example.com')
		expect(siteName('http://alpha.localhost:4740/')).toBe('alpha.localhost:4740')
		expect(siteName('https://example.com/de')).toBe('example.com/de')
	})
})

describe('siteAddress', () => {
	it('keeps an http(s) origin and its path, nothing after', () => {
		expect(siteAddress('https://shop.example.com')).toBe('https://shop.example.com/')
		expect(siteAddress('https://example.com/de?x=1#top')).toBe('https://example.com/de')
		expect(siteAddress('http://alpha.localhost:4740')).toBe('http://alpha.localhost:4740/')
	})

	it('drops anything that is not an http(s) address', () => {
		for (const candidate of ['shop.example.com', 'javascript:alert(1)', 'ftp://x.test', 7, null]) {
			expect(siteAddress(candidate)).toBeNull()
		}
	})
})

describe('readExclusionResponse', () => {
	it('reads the endpoint answer, an undecided origin included', () => {
		for (const sameOrigin of [true, false, null]) {
			const body = {
				...link,
				sameOrigin,
				sites: [{ address: 'https://shop.example.com/', token: 'xyz' }],
			}
			expect(readExclusionResponse(body)).toEqual(body)
		}
	})

	it('answers null for anything else, an error envelope included', () => {
		expect(readExclusionResponse({ error: { code: 'forbidden' } })).toBeNull()
		expect(readExclusionResponse({ ...link })).toBeNull()
		expect(readExclusionResponse({ ...link, sameOrigin: 'yes', sites: [] })).toBeNull()
		expect(readExclusionResponse({ ...link, sameOrigin: null })).toBeNull()
		expect(readExclusionResponse({ ...link, sameOrigin: null, sites: [1] })).toBeNull()
		expect(
			readExclusionResponse({ ...link, sameOrigin: null, sites: ['https://shop.example.com/'] })
		).toBeNull()
		expect(
			readExclusionResponse({
				...link,
				sameOrigin: null,
				sites: [{ address: 'https://shop.example.com/' }],
			})
		).toBeNull()
		expect(readExclusionResponse(null)).toBeNull()
		expect(readExclusionResponse('token')).toBeNull()
	})
})
