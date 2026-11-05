import { readStorage, writeStorage } from './storage'
import type { TrackerWindow } from './types'

/** Where the exclusion flag lives. Stable across releases: hosts read it too. */
export const EXCLUSION_STORAGE_KEY = 'analytics:exclude'

/** The query parameter an exclusion link uses, unless `capture.exclusion.param` renames it. */
export const DEFAULT_EXCLUSION_PARAM = 'analytics_exclude'

/**
 * Non-enumerable window property where `exclusionPrelude` stashes the link's value after stripping
 * it from the address; deleted after {@link EXCLUSION_STASH_MS} if no tracker took it.
 */
export const EXCLUSION_STASH_KEY = '__analyticsExclusion'

/** How long a rendered snippet leaves the link's value for a tracker that has not booted yet. */
export const EXCLUSION_STASH_MS = 30_000

const EXCLUDED = '1'

/** Far longer than a token; anything past it is not one, and is not worth hashing. */
const MAX_TOKEN_LENGTH = 128

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

/** Tells the subscribers what a tracker now knows of the flag, without touching storage. */
export const announceExclusion = (excluded: boolean): void => {
	for (const listener of listeners) {
		listener(excluded)
	}
}

/** The persisted flag. False when absent or unreadable. */
export const readExclusion = (win: TrackerWindow): boolean =>
	readStorage(win, EXCLUSION_STORAGE_KEY) === EXCLUDED

/**
 * Persists the flag, or removes the key entirely, and tells the subscribers. With storage blocked
 * the caller's in-memory value holds the exclusion for this page only.
 */
export const writeExclusion = (win: TrackerWindow, excluded: boolean): void => {
	writeStorage(win, EXCLUSION_STORAGE_KEY, excluded ? EXCLUDED : null)
	announceExclusion(excluded)
}

export type ExclusionLinkValue = 'include' | { token: string } | null

/**
 * What the link's parameter asks: `0` or `false` puts the browser back, any other value is a token
 * still to check, and an absent or empty parameter asks nothing.
 */
export const exclusionLinkValueOf = (value: string | null): ExclusionLinkValue => {
	if (value === null || value === '') {
		return null
	}
	if (value === '0' || value === 'false') {
		return 'include'
	}
	return value.length <= MAX_TOKEN_LENGTH ? { token: value } : null
}

/** The value a rendered snippet stashed, taken once; null when none did. */
export const takeStashedExclusion = (win: TrackerWindow): string | null => {
	const value: unknown = Reflect.get(win, EXCLUSION_STASH_KEY)
	if (value === undefined) {
		return null
	}
	Reflect.deleteProperty(win, EXCLUSION_STASH_KEY)
	return typeof value === 'string' ? value : null
}

const paramName = (pair: string): string | null => {
	const name = pair.split('=')[0] ?? ''
	try {
		return decodeURIComponent(name.replaceAll('+', ' '))
	} catch {
		return null
	}
}

/**
 * Strips the parameter from the address before any check, so no copied link, screenshot or later
 * pageview carries the token; the rest of the address is kept exactly as written.
 */
export const forgetExclusionParam = (win: TrackerWindow, param: string): void => {
	const { pathname, search, hash } = win.location
	const pairs = search
		.replace(/^\?/, '')
		.split('&')
		.filter((pair) => pair !== '')
	const kept = pairs.filter((pair) => paramName(pair) !== param)
	if (kept.length === pairs.length) {
		return
	}
	try {
		win.history.replaceState(
			win.history.state,
			'',
			`${pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`
		)
	} catch {
		// A sandboxed frame, or a browser throttling history writes: the address keeps the link.
	}
}
