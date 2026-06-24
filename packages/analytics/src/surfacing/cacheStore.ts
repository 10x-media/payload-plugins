import type { KVAdapter } from 'payload'

export interface CacheStore {
	get<T>(key: string): Promise<T | null>
	set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
	// Injected for testing; defaults to Date.now
	now: () => number
}

interface Wrapped<T> {
	value: T
	expiresAt: number
}

export function kvCacheStore(kv: KVAdapter): CacheStore {
	const store: CacheStore = {
		now: () => Date.now(),
		async get<T>(key: string): Promise<T | null> {
			const hit = await kv.get<Wrapped<T>>(key)
			if (!hit) return null
			if (hit.expiresAt <= store.now()) {
				await kv.delete(key)
				return null
			}
			return hit.value
		},
		async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
			await kv.set(key, { value, expiresAt: store.now() + ttlSeconds * 1000 } satisfies Wrapped<T>)
		},
	}
	return store
}
