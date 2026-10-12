import type { TrackerWindow } from './types'

/**
 * A `localStorage` value, or null when absent or unreadable: storage can be disabled (Safari
 * private mode, a strict partitioning policy), and then nothing was persisted there either.
 */
export const readStorage = (win: TrackerWindow, key: string): string | null => {
	try {
		return win.localStorage?.getItem(key) ?? null
	} catch {
		return null
	}
}

/** Sets a `localStorage` key, or removes it for null. Blocked storage is skipped, never an error. */
export const writeStorage = (win: TrackerWindow, key: string, value: string | null): void => {
	try {
		if (value === null) {
			win.localStorage?.removeItem(key)
		} else {
			win.localStorage?.setItem(key, value)
		}
	} catch {
		// Storage disabled: the caller's in-memory state holds for this page only.
	}
}
