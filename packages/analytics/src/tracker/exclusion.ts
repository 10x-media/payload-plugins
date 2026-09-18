import type { TrackerWindow } from './types'

/** Where the exclusion flag lives. Stable across releases: hosts read it too. */
export const EXCLUSION_STORAGE_KEY = 'analytics:exclude'

/** The query parameter that flips the flag, unless the host renamed or disabled it. */
export const DEFAULT_EXCLUSION_PARAM = 'analytics_exclude'

const EXCLUDED = '1'
const INCLUDED = '0'

type ExclusionListener = (excluded: boolean) => void

const listeners = new Set<ExclusionListener>()

/**
 * Notified after every write, so a React tree can render the flag without polling storage.
 * Returns the unsubscribe.
 */
export const subscribeExclusion = (listener: ExclusionListener): (() => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** The persisted flag. False when absent or unreadable. */
export const readExclusion = (win: TrackerWindow): boolean => {
	try {
		return win.localStorage?.getItem(EXCLUSION_STORAGE_KEY) === EXCLUDED
	} catch {
		// Storage disabled (Safari private mode, a strict partitioning policy).
		return false
	}
}

/**
 * Persists the flag and tells the subscribers. Blocked storage is not a failure: the caller
 * keeps the value in memory, so the exclusion holds for this page and is gone on the next.
 */
export const writeExclusion = (win: TrackerWindow, excluded: boolean): void => {
	try {
		win.localStorage?.setItem(EXCLUSION_STORAGE_KEY, excluded ? EXCLUDED : INCLUDED)
	} catch {
		// Storage disabled; the flag holds for this page only.
	}
	for (const listener of listeners) {
		listener(excluded)
	}
}

/**
 * What a query string asks for: `1` or `true` excludes, `0` or `false` includes, and an
 * absent parameter or any other value leaves the stored flag as it is.
 */
export const readExclusionParam = (search: string, param: string): boolean | null => {
	const value = new URLSearchParams(search).get(param)
	if (value === '1' || value === 'true') {
		return true
	}
	if (value === '0' || value === 'false') {
		return false
	}
	return null
}
