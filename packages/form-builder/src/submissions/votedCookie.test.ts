import { describe, expect, it } from 'vitest'
import { hasVotedCookie, votedCookieName } from './votedCookie'

describe('votedCookieName', () => {
	it('prefixes the form id', () => {
		expect(votedCookieName(7)).toBe('fb-voted-7')
		expect(votedCookieName('abc123')).toBe('fb-voted-abc123')
	})
})

describe('hasVotedCookie', () => {
	it('is false for a missing header', () => {
		expect(hasVotedCookie(null, 1)).toBe(false)
		expect(hasVotedCookie(undefined, 1)).toBe(false)
		expect(hasVotedCookie('', 1)).toBe(false)
	})

	it('finds the marker among other cookies', () => {
		expect(hasVotedCookie('session=xyz; fb-voted-1=1; theme=dark', 1)).toBe(true)
		expect(hasVotedCookie('fb-voted-1=1', 1)).toBe(true)
	})

	it('matches the exact cookie name, not a prefix', () => {
		expect(hasVotedCookie('fb-voted-12=1', 1)).toBe(false)
		expect(hasVotedCookie('fb-voted-1=1', 12)).toBe(false)
	})

	it('is false when only unrelated cookies exist', () => {
		expect(hasVotedCookie('session=xyz; theme=dark', 1)).toBe(false)
	})

	it('ignores a name-only fragment without a value', () => {
		expect(hasVotedCookie('fb-voted-1', 1)).toBe(false)
	})

	it('tolerates whitespace around pairs', () => {
		expect(hasVotedCookie(' fb-voted-9=1 ;other=2', 9)).toBe(true)
	})
})
