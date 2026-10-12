import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exclusionPrelude } from '../capture/exclusionPrelude'
import { exclusionToken, exclusionTokenHash } from '../capture/exclusionToken'
import { matchesDigest } from './digest'
import {
	DEFAULT_EXCLUSION_PARAM,
	EXCLUSION_STASH_KEY,
	EXCLUSION_STASH_MS,
	EXCLUSION_STORAGE_KEY,
	exclusionLinkValueOf,
	forgetExclusionParam,
	readExclusion,
	subscribeExclusion,
	takeStashedExclusion,
	writeExclusion,
} from './exclusion'
import type { TrackerWindow } from './types'

const exclusionLinkValue = (search: string, param: string) =>
	exclusionLinkValueOf(new URLSearchParams(search).get(param))

const asWin = (localStorage: unknown): TrackerWindow =>
	({ localStorage }) as unknown as TrackerWindow

describe('exclusion persistence', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it('round-trips the flag through localStorage', () => {
		expect(EXCLUSION_STORAGE_KEY).toBe('analytics:exclude')
		expect(readExclusion(window)).toBe(false)

		writeExclusion(window, true)

		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
		expect(readExclusion(window)).toBe(true)

		writeExclusion(window, false)

		expect(readExclusion(window)).toBe(false)
	})

	it('removes the key when the browser is put back, rather than storing a 0', () => {
		writeExclusion(window, true)
		writeExclusion(window, false)

		expect(Object.keys(window.localStorage)).toEqual([])
	})

	it('survives a storage that throws, and one that is not there at all', () => {
		const throwing = asWin({
			getItem: () => {
				throw new Error('denied')
			},
			setItem: () => {
				throw new Error('denied')
			},
		})
		expect(readExclusion(throwing)).toBe(false)
		expect(() => writeExclusion(throwing, true)).not.toThrow()
		expect(readExclusion(asWin(undefined))).toBe(false)
		expect(() => writeExclusion(asWin(undefined), true)).not.toThrow()
	})

	it('notifies subscribers on every write until they unsubscribe', () => {
		const seen: boolean[] = []
		const stop = subscribeExclusion((excluded) => seen.push(excluded))

		writeExclusion(window, true)
		stop()
		writeExclusion(window, false)

		expect(seen).toEqual([true])
	})

	it('notifies even when storage refused the write', () => {
		const seen: boolean[] = []
		const stop = subscribeExclusion((excluded) => seen.push(excluded))

		writeExclusion(
			asWin({
				setItem: () => {
					throw new Error('denied')
				},
			}),
			true
		)
		stop()

		expect(seen).toEqual([true])
	})
})

describe('the exclusion link parameter', () => {
	it('is analytics_exclude by default', () => {
		expect(DEFAULT_EXCLUSION_PARAM).toBe('analytics_exclude')
	})

	it('reads 0 and false as putting the browser back, with no token', () => {
		expect(exclusionLinkValue('?analytics_exclude=0', DEFAULT_EXCLUSION_PARAM)).toBe('include')
		expect(exclusionLinkValue('?a=b&analytics_exclude=false', DEFAULT_EXCLUSION_PARAM)).toBe(
			'include'
		)
	})

	it('reads every other value as a token still to be checked, 1 and true included', () => {
		expect(exclusionLinkValue('?analytics_exclude=abc', DEFAULT_EXCLUSION_PARAM)).toEqual({
			token: 'abc',
		})
		expect(exclusionLinkValue('?analytics_exclude=1', DEFAULT_EXCLUSION_PARAM)).toEqual({
			token: '1',
		})
		expect(exclusionLinkValue('?staff=true', 'staff')).toEqual({ token: 'true' })
	})

	it('asks nothing for an absent, empty or far too long parameter', () => {
		expect(exclusionLinkValue('', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(exclusionLinkValue('?other=1', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(exclusionLinkValue('?analytics_exclude=', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(
			exclusionLinkValue(`?analytics_exclude=${'a'.repeat(129)}`, DEFAULT_EXCLUSION_PARAM)
		).toBeNull()
	})
})

describe('checking a token against the config', () => {
	const token = exclusionToken('test-secret', 'tenant-a')
	const tokenHash = exclusionTokenHash(token)

	it('accepts the token the server signed for the scope', async () => {
		expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
		expect(await matchesDigest(window, token, tokenHash)).toBe(true)
	})

	it("refuses a wrong token, another scope's and the install-wide one", async () => {
		expect(await matchesDigest(window, 'wrong', tokenHash)).toBe(false)
		expect(await matchesDigest(window, exclusionToken('test-secret', 'tenant-b'), tokenHash)).toBe(
			false
		)
		expect(await matchesDigest(window, exclusionToken('test-secret', null), tokenHash)).toBe(false)
		expect(
			await matchesDigest(window, exclusionToken('another-secret', 'tenant-a'), tokenHash)
		).toBe(false)
	})

	it('refuses where the browser offers no crypto.subtle, as on plain http', async () => {
		const insecure = { crypto: {} } as unknown as TrackerWindow
		expect(await matchesDigest(insecure, token, tokenHash)).toBe(false)
	})

	it('signs the scope with HMAC-SHA256 under the exclusion context, as base64url', () => {
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(exclusionToken('test-secret', null)).toBe(exclusionToken('test-secret', ''))
		expect(exclusionToken('test-secret', 'tenant-a')).not.toBe(exclusionToken('test-secret', null))
	})
})

describe('the value a rendered snippet keeps for the tracker', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		window.history.replaceState(null, '', '/pricing?analytics_exclude=tok3n')
	})

	afterEach(() => {
		Reflect.deleteProperty(window, EXCLUSION_STASH_KEY)
		vi.useRealTimers()
		window.history.replaceState(null, '', '/')
	})

	it('is a property no enumeration of the window lists', () => {
		new Function(exclusionPrelude(DEFAULT_EXCLUSION_PARAM))()

		expect(Object.getOwnPropertyDescriptor(window, EXCLUSION_STASH_KEY)?.enumerable).toBe(false)
		expect(Object.keys(window)).not.toContain(EXCLUSION_STASH_KEY)
		expect(takeStashedExclusion(window)).toBe('tok3n')
		expect(Reflect.get(window, EXCLUSION_STASH_KEY)).toBeUndefined()
	})

	it('is deleted once its time is up when no tracker took it', () => {
		new Function(exclusionPrelude(DEFAULT_EXCLUSION_PARAM))()
		vi.advanceTimersByTime(EXCLUSION_STASH_MS - 1)
		expect(Reflect.get(window, EXCLUSION_STASH_KEY)).toBe('tok3n')

		vi.advanceTimersByTime(1)

		expect(Reflect.get(window, EXCLUSION_STASH_KEY)).toBeUndefined()
		expect(takeStashedExclusion(window)).toBeNull()
	})
})

describe('taking the parameter out of the address', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/pricing')
	})

	it('removes the parameter and keeps everything else as written', () => {
		window.history.replaceState(null, '', '/pricing?utm_source=a%20b&analytics_exclude=tok&x=1#top')

		forgetExclusionParam(window, 'analytics_exclude')

		expect(window.location.pathname).toBe('/pricing')
		expect(window.location.search).toBe('?utm_source=a%20b&x=1')
		expect(window.location.hash).toBe('#top')
	})

	it('drops the question mark when nothing else is left', () => {
		window.history.replaceState(null, '', '/pricing?analytics_exclude=tok')

		forgetExclusionParam(window, 'analytics_exclude')

		expect(window.location.search).toBe('')
	})

	it('leaves an address without the parameter alone', () => {
		window.history.replaceState(null, '', '/pricing?a=1&&b=2')
		const replace = vi.spyOn(window.history, 'replaceState')

		forgetExclusionParam(window, 'analytics_exclude')

		expect(replace).not.toHaveBeenCalled()
		expect(window.location.search).toBe('?a=1&&b=2')
		replace.mockRestore()
	})

	it('keeps the address when the history refuses the rewrite', () => {
		window.history.replaceState(null, '', '/pricing?analytics_exclude=tok')
		const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
			throw new Error('SecurityError')
		})

		expect(() => forgetExclusionParam(window, 'analytics_exclude')).not.toThrow()

		replace.mockRestore()
		expect(window.location.search).toBe('?analytics_exclude=tok')
	})
})
