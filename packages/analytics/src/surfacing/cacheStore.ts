import type { KVAdapter } from 'payload'

export interface CacheStore {
	get<T>(key: string): Promise<T | null>
	/** Serves a value past `expiresAt` but still within the stale window; null once cold or past it. */
	getStale<T>(key: string): Promise<T | null>
	set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
	// Injected for testing; defaults to Date.now
	now: () => number
}

/** How long past expiry a value stays eligible for stale-while-error serving. */
export const STALE_WINDOW_SECONDS = 86_400

interface Wrapped<T> {
	value: T
	expiresAt: number
	// Absent on entries written before stale-while-error shipped; treated as expiresAt (never stale-served).
	staleUntil?: number
}

export function kvCacheStore(kv: KVAdapter): CacheStore {
	const store: CacheStore = {
		now: () => Date.now(),
		async get<T>(key: string): Promise<T | null> {
			const hit = await kv.get<Wrapped<T>>(key)
			if (!hit) return null
			const staleUntil = hit.staleUntil ?? hit.expiresAt
			if (staleUntil <= store.now()) {
				await kv.delete(key)
				return null
			}
			if (hit.expiresAt <= store.now()) return null
			return hit.value
		},
		async getStale<T>(key: string): Promise<T | null> {
			const hit = await kv.get<Wrapped<T>>(key)
			if (!hit) return null
			const now = store.now()
			const staleUntil = hit.staleUntil ?? hit.expiresAt
			if (staleUntil <= now) {
				await kv.delete(key)
				return null
			}
			if (hit.expiresAt > now) return null
			return hit.value
		},
		async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
			const expiresAt = store.now() + ttlSeconds * 1000
			await kv.set(key, {
				value,
				expiresAt,
				staleUntil: expiresAt + STALE_WINDOW_SECONDS * 1000,
			} satisfies Wrapped<T>)
		},
	}
	return store
}
