import type { ConsentState, TrackerWindow } from './types'

/** Where a persisted decision lives. Stable across releases: hosts read it too. */
export const CONSENT_STORAGE_KEY = 'analytics:consent'

/**
 * How many events wait for a decision before the oldest is dropped. A visitor who never
 * answers the banner must not grow the tab's memory without bound.
 */
export const CONSENT_QUEUE_LIMIT = 100

const isConsentState = (value: unknown): value is ConsentState =>
	value === 'granted' || value === 'denied'

/** Reads the persisted decision. Null when absent, unreadable, or not a decision. */
export const readConsent = (win: TrackerWindow): ConsentState | null => {
	try {
		const stored = win.localStorage?.getItem(CONSENT_STORAGE_KEY)
		return isConsentState(stored) ? stored : null
	} catch {
		// Storage disabled (Safari private mode, a strict partitioning policy).
		return null
	}
}

export const writeConsent = (win: TrackerWindow, state: ConsentState): void => {
	try {
		win.localStorage?.setItem(CONSENT_STORAGE_KEY, state)
	} catch {
		// Storage disabled; the decision holds for this page only.
	}
}

export interface ConsentQueue<T> {
	push(item: T): void
	drain(): T[]
	clear(): void
	readonly size: number
}

/** Bounded FIFO buffer holding events until a consent decision arrives. */
export const createConsentQueue = <T>(limit: number = CONSENT_QUEUE_LIMIT): ConsentQueue<T> => {
	let items: T[] = []
	return {
		push(item) {
			items.push(item)
			if (items.length > limit) {
				items.splice(0, items.length - limit)
			}
		},
		drain() {
			const drained = items
			items = []
			return drained
		},
		clear() {
			items = []
		},
		get size() {
			return items.length
		},
	}
}
