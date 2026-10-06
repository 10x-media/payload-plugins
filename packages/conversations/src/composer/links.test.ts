import { describe, expect, it } from 'vitest'

import { displayUrl, isAllowedUrl, normalizeUrl } from './links'

describe('composer links', () => {
	it('keeps http, https and mailto URLs', () => {
		expect(normalizeUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1')
		expect(normalizeUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
	})

	it('completes bare domains and email addresses', () => {
		expect(normalizeUrl('example.com/path')).toBe('https://example.com/path')
		expect(normalizeUrl('sub.example.org:8080')).toBe('https://sub.example.org:8080')
		expect(normalizeUrl('anna@10xmedia.de')).toBe('mailto:anna@10xmedia.de')
	})

	it('rejects other schemes and non-URLs', () => {
		expect(normalizeUrl('javascript:alert(1)')).toBeNull()
		expect(normalizeUrl('ftp://example.com')).toBeNull()
		expect(normalizeUrl('two words')).toBeNull()
		expect(normalizeUrl('nodot')).toBeNull()
		expect(normalizeUrl('')).toBeNull()
		expect(isAllowedUrl('data:text/html,x')).toBe(false)
	})

	it('shows a URL without its scheme', () => {
		expect(displayUrl('https://example.com/')).toBe('example.com')
		expect(displayUrl('mailto:a@b.co')).toBe('a@b.co')
	})
})
