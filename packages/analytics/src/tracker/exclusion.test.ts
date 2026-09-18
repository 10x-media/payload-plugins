import { beforeEach, describe, expect, it } from 'vitest'
import {
	DEFAULT_EXCLUSION_PARAM,
	EXCLUSION_STORAGE_KEY,
	readExclusion,
	readExclusionParam,
	subscribeExclusion,
	writeExclusion,
} from './exclusion'
import type { TrackerWindow } from './types'

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

describe('the exclusion parameter', () => {
	it('is analytics_exclude by default', () => {
		expect(DEFAULT_EXCLUSION_PARAM).toBe('analytics_exclude')
	})

	it('reads 1 and true as excluded, 0 and false as included', () => {
		expect(readExclusionParam('?analytics_exclude=1', DEFAULT_EXCLUSION_PARAM)).toBe(true)
		expect(readExclusionParam('analytics_exclude=true', DEFAULT_EXCLUSION_PARAM)).toBe(true)
		expect(readExclusionParam('?analytics_exclude=0', DEFAULT_EXCLUSION_PARAM)).toBe(false)
		expect(readExclusionParam('?a=b&analytics_exclude=false', DEFAULT_EXCLUSION_PARAM)).toBe(false)
	})

	it('leaves the flag alone for an absent parameter or any other value', () => {
		expect(readExclusionParam('', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(readExclusionParam('?other=1', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(readExclusionParam('?analytics_exclude=', DEFAULT_EXCLUSION_PARAM)).toBeNull()
		expect(readExclusionParam('?analytics_exclude=yes', DEFAULT_EXCLUSION_PARAM)).toBeNull()
	})

	it('reads the name the host chose', () => {
		expect(readExclusionParam('?staff=1', 'staff')).toBe(true)
	})
})
