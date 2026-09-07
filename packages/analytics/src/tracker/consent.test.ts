import { beforeEach, describe, expect, it } from 'vitest'
import {
	CONSENT_QUEUE_LIMIT,
	CONSENT_STORAGE_KEY,
	createConsentQueue,
	readConsent,
	writeConsent,
} from './consent'
import type { TrackerWindow } from './types'

const asWin = (localStorage: unknown): TrackerWindow =>
	({ localStorage }) as unknown as TrackerWindow

describe('consent persistence', () => {
	beforeEach(() => {
		window.localStorage.clear()
	})

	it('round-trips a decision through localStorage', () => {
		writeConsent(window, 'granted')
		expect(CONSENT_STORAGE_KEY).toBe('analytics:consent')
		expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('granted')
		expect(readConsent(window)).toBe('granted')
	})

	it('reads null when nothing is stored or the value is not a decision', () => {
		expect(readConsent(window)).toBeNull()
		window.localStorage.setItem(CONSENT_STORAGE_KEY, 'maybe')
		expect(readConsent(window)).toBeNull()
	})

	it('survives a storage that throws', () => {
		const throwing = asWin({
			getItem: () => {
				throw new Error('denied')
			},
			setItem: () => {
				throw new Error('denied')
			},
		})
		expect(readConsent(throwing)).toBeNull()
		expect(() => writeConsent(throwing, 'denied')).not.toThrow()
	})
})

describe('createConsentQueue', () => {
	it('drains in FIFO order and empties itself', () => {
		const queue = createConsentQueue<number>()
		queue.push(1)
		queue.push(2)
		expect(queue.size).toBe(2)
		expect(queue.drain()).toEqual([1, 2])
		expect(queue.size).toBe(0)
		expect(queue.drain()).toEqual([])
	})

	it('drops the oldest entry past the cap', () => {
		const queue = createConsentQueue<number>()
		for (let i = 0; i < CONSENT_QUEUE_LIMIT + 5; i += 1) {
			queue.push(i)
		}
		const drained = queue.drain()
		expect(CONSENT_QUEUE_LIMIT).toBe(100)
		expect(drained).toHaveLength(CONSENT_QUEUE_LIMIT)
		expect(drained[0]).toBe(5)
		expect(drained.at(-1)).toBe(CONSENT_QUEUE_LIMIT + 4)
	})

	it('clears without draining', () => {
		const queue = createConsentQueue<number>()
		queue.push(1)
		queue.clear()
		expect(queue.size).toBe(0)
		expect(queue.drain()).toEqual([])
	})
})
