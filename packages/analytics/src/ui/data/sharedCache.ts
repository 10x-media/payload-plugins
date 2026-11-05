/**
 * Where a shared read lives: the endpoint's route, the scope the answer was given for, and the
 * rest of what was asked. Two readers that differ in any of them never share an answer.
 */
export interface SharedKey {
	route: string
	/** {@link requestScopeKey}'s token for the request that reads it. */
	scope: string
	path?: string
}

export interface SharedCache<T> {
	/**
	 * The answer for `key`, loaded once and shared by every caller until it settles in failure:
	 * a failed load drops its entry, so the next caller tries again rather than inheriting it.
	 */
	read: (key: SharedKey, load: () => Promise<T>) => Promise<T>
}

/** Clearing forgets every answer of every kind; each cache registers how it clears. */
const clears = new Set<() => void>()

/** Scopes a cache keeps answers for: the reader's current few, the oldest forgotten first. */
export const MAX_SHARED_SCOPES = 8

const entryKeyOf = ({ route, path }: SharedKey): string => `${route}|${path ?? ''}`

/**
 * One promise cache for the pickers' repeated reads, typed per answer kind and cleared together. Only
 * the {@link MAX_SHARED_SCOPES} latest scopes are kept, so tenant switching cannot grow it unbounded.
 */
export const createSharedCache = <T>(): SharedCache<T> => {
	const scopes = new Map<string, Map<string, Promise<T>>>()
	clears.add(() => scopes.clear())
	/** The scope's answers, marked most recently read; the least recent past the limit are dropped. */
	const entriesOf = (scope: string): Map<string, Promise<T>> => {
		const entries = scopes.get(scope) ?? new Map<string, Promise<T>>()
		scopes.delete(scope)
		scopes.set(scope, entries)
		for (const oldest of scopes.keys()) {
			if (scopes.size <= MAX_SHARED_SCOPES) {
				break
			}
			scopes.delete(oldest)
		}
		return entries
	}
	return {
		read: (key, load) => {
			const entries = entriesOf(key.scope)
			const id = entryKeyOf(key)
			const hit = entries.get(id)
			if (hit) {
				return hit
			}
			const pending = load().catch((err: unknown) => {
				if (entries.get(id) === pending) {
					entries.delete(id)
				}
				throw err
			})
			entries.set(id, pending)
			return pending
		},
	}
}

/** Forgets every shared answer, for tests and for whatever must start over. */
export const clearSharedCaches = (): void => {
	for (const clear of clears) {
		clear()
	}
}

/** Cookies whose value says nothing about which scope a request reads. */
const IGNORED_COOKIE = /^__next/

/**
 * The scope a request from this page reads, as far as it can tell: the user and `document.cookie`. A
 * tenant selector sets a cookie and refreshes, so a new selection is a new token.
 */
export const requestScopeKey = (userKey: string, cookies: string): string => {
	const relevant = cookies
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part !== '' && !IGNORED_COOKIE.test(part))
		.sort()
	return `${userKey}#${relevant.join(';')}`
}
