import { describe, expect, it } from 'vitest'
import { MAX_REFERRER_LENGTH } from '../../query/limits'
import { referrerHost, storedReferrer } from './referrer'

/** The event's own hostname in every case that is not about self-referrals. */
const SELF = 'site.example'

describe('referrerHost', () => {
	it('keeps the bare host, dropping scheme, port, path, query and fragment', () => {
		expect(referrerHost('https://example.org/path?x=1#top', SELF)).toBe('example.org')
		expect(referrerHost('http://example.org:8080/path', SELF)).toBe('example.org')
	})

	it('lowercases the host', () => {
		expect(referrerHost('https://EXAMPLE.ORG/Path', SELF)).toBe('example.org')
	})

	it('strips a leading www. and nothing that merely starts with www', () => {
		expect(referrerHost('https://www.example.org/path', SELF)).toBe('example.org')
		expect(referrerHost('https://wwwexample.org/', SELF)).toBe('wwwexample.org')
		expect(referrerHost('https://www.www.example.org/', SELF)).toBe('www.example.org')
	})

	it('keeps an IPv6 host in its bracketed form', () => {
		expect(referrerHost('http://[2001:db8::1]:8080/x', SELF)).toBe('[2001:db8::1]')
	})

	it('reports nothing for an absent, empty or unparseable referrer', () => {
		expect(referrerHost(undefined, SELF)).toBeUndefined()
		expect(referrerHost('', SELF)).toBeUndefined()
		expect(referrerHost('not a url', SELF)).toBeUndefined()
	})

	it('reports nothing for a URL that carries no host', () => {
		expect(referrerHost('about:blank', SELF)).toBeUndefined()
	})

	it('reports nothing for a value that is not a string', () => {
		expect(referrerHost({} as unknown as string, SELF)).toBeUndefined()
		expect(referrerHost(42 as unknown as string, SELF)).toBeUndefined()
		expect(referrerHost([] as unknown as string, SELF)).toBeUndefined()
	})

	it('excludes a self-referral, whatever its case or www prefix', () => {
		expect(referrerHost('https://site.example/pricing', 'site.example')).toBeUndefined()
		expect(referrerHost('https://www.site.example/pricing', 'site.example')).toBeUndefined()
		expect(referrerHost('https://Site.Example/pricing', 'WWW.site.example')).toBeUndefined()
	})

	it('keeps a different host on the same registrable domain', () => {
		expect(referrerHost('https://blog.site.example/x', 'site.example')).toBe('blog.site.example')
	})

	it('caps an absurd host at the longest legal DNS name', () => {
		const host = `${'a'.repeat(300)}.example`
		expect(referrerHost(`https://${host}/`, SELF)).toHaveLength(253)
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

	it('reports nothing for a value that is not a string, since the wire field is public', () => {
		expect(storedReferrer({} as unknown as string)).toBeUndefined()
		expect(storedReferrer(42 as unknown as string)).toBeUndefined()
		expect(storedReferrer(['https://example.org/'] as unknown as string)).toBeUndefined()
		expect(storedReferrer(true as unknown as string)).toBeUndefined()
	})
})
