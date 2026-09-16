import { describe, expect, it } from 'vitest'
import { MAX_REFERRER_LENGTH } from '../../query/limits'
import { referrerHost, storedReferrer } from './referrer'

describe('referrerHost', () => {
	it('keeps the bare host, dropping scheme, port, path, query and fragment', () => {
		expect(referrerHost('https://example.org/path?x=1#top')).toBe('example.org')
		expect(referrerHost('http://example.org:8080/path')).toBe('example.org')
	})

	it('lowercases the host', () => {
		expect(referrerHost('https://EXAMPLE.ORG/Path')).toBe('example.org')
	})

	it('strips a leading www. and nothing that merely starts with www', () => {
		expect(referrerHost('https://www.example.org/path')).toBe('example.org')
		expect(referrerHost('https://wwwexample.org/')).toBe('wwwexample.org')
		expect(referrerHost('https://www.www.example.org/')).toBe('www.example.org')
	})

	it('keeps an IPv6 host in its bracketed form', () => {
		expect(referrerHost('http://[2001:db8::1]:8080/x')).toBe('[2001:db8::1]')
	})

	it('reports nothing for an absent, empty or unparseable referrer', () => {
		expect(referrerHost(undefined)).toBeUndefined()
		expect(referrerHost('')).toBeUndefined()
		expect(referrerHost('not a url')).toBeUndefined()
	})

	it('reports nothing for a URL that carries no host', () => {
		expect(referrerHost('about:blank')).toBeUndefined()
	})

	it('caps an absurd host at the longest legal DNS name', () => {
		const host = `${'a'.repeat(300)}.example`
		expect(referrerHost(`https://${host}/`)).toHaveLength(253)
	})
})

describe('storedReferrer', () => {
	it('drops the query string and the fragment, keeping origin and path', () => {
		expect(storedReferrer('https://example.org/path?token=abc#x')).toBe('https://example.org/path')
	})

	it('drops a query that hides inside the fragment', () => {
		expect(storedReferrer('https://example.org/path#/spa?token=abc')).toBe(
			'https://example.org/path'
		)
	})

	it('keeps a plain referrer verbatim, case, port and trailing slash included', () => {
		expect(storedReferrer('https://www.Example.org:8080/a/b/')).toBe(
			'https://www.Example.org:8080/a/b/'
		)
	})

	it('strips an unparseable referrer too, rather than trusting it', () => {
		expect(storedReferrer('not a url?token=abc')).toBe('not a url')
	})

	it('caps a long referrer', () => {
		const long = `https://example.org/${'a'.repeat(MAX_REFERRER_LENGTH)}`
		expect(storedReferrer(long)).toHaveLength(MAX_REFERRER_LENGTH)
	})

	it('reports nothing for an absent, empty or query-only referrer', () => {
		expect(storedReferrer(undefined)).toBeUndefined()
		expect(storedReferrer('')).toBeUndefined()
		expect(storedReferrer('?token=abc')).toBeUndefined()
	})
})
