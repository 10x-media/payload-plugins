import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { signFormContext } from '../context/formContext'
import {
	hasVotedCookie,
	signVotedCookieValue,
	votedCookieName,
	votedSubmissionIdFromCookie,
} from './votedCookie'

const SECRET = 'test-secret'
const fakePayload = { secret: SECRET } as Payload

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

	it('is true for a signed submission-id value too', () => {
		const token = signVotedCookieValue(fakePayload, 'sub-1')
		expect(hasVotedCookie(`fb-voted-3=${token}`, 3)).toBe(true)
	})
})

describe('votedSubmissionIdFromCookie', () => {
	it('round-trips a signed submission id', () => {
		const token = signVotedCookieValue(fakePayload, 'sub-42')
		const header = `session=xyz; ${votedCookieName(7)}=${token}`
		expect(votedSubmissionIdFromCookie(header, 7, SECRET)).toBe('sub-42')
	})

	it('preserves numeric ids as strings', () => {
		const token = signVotedCookieValue(fakePayload, 42)
		expect(votedSubmissionIdFromCookie(`${votedCookieName(1)}=${token}`, 1, SECRET)).toBe('42')
	})

	it('returns null for the legacy boolean marker', () => {
		expect(votedSubmissionIdFromCookie(`${votedCookieName(7)}=1`, 7, SECRET)).toBeNull()
	})

	it('returns null for a missing header or cookie', () => {
		expect(votedSubmissionIdFromCookie(null, 7, SECRET)).toBeNull()
		expect(votedSubmissionIdFromCookie('other=1', 7, SECRET)).toBeNull()
	})

	it('rejects a tampered token', () => {
		const token = signVotedCookieValue(fakePayload, 'sub-42')
		const forged = `${token.slice(0, -2)}ff`
		expect(votedSubmissionIdFromCookie(`${votedCookieName(7)}=${forged}`, 7, SECRET)).toBeNull()
	})

	it('rejects a token signed with a different secret', () => {
		const token = signVotedCookieValue({ secret: 'other-secret' } as Payload, 'sub-42')
		expect(votedSubmissionIdFromCookie(`${votedCookieName(7)}=${token}`, 7, SECRET)).toBeNull()
	})

	it('rejects a validly signed token for a different relation', () => {
		// e.g. a signFormContext token for a page reference dropped into the voted cookie.
		const token = signFormContext({
			payload: fakePayload,
			relationTo: 'pages',
			value: 'sub-42',
		})
		expect(votedSubmissionIdFromCookie(`${votedCookieName(7)}=${token}`, 7, SECRET)).toBeNull()
	})
})
