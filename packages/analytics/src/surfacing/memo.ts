import { currentTime } from '../core/clock'

/** The most entries one instance keeps in memory. */
export const MEMO_CAPACITY = 500

/** How long an aggregate read is answered from memory before the store is asked again. */
export const AGGREGATE_MEMO_MS = 15_000

/**
 * In-process LRU cache in front of the store, one per Payload instance, each entry with its own
 * TTL. Values are shared between callers, so none may change one.
 */
export interface Memo<V> {
	get(key: string): V | undefined
	/** Keeps `value` for `ttlMs`; nothing is kept for a time of zero or less. */
	set(key: string, value: V, ttlMs: number): void
	delete(key: string): void
	readonly size: number
}

export const createMemo = <V>(options: { capacity?: number; now?: () => number } = {}): Memo<V> => {
	const capacity = options.capacity ?? MEMO_CAPACITY
	const now = options.now ?? currentTime
	// A Map iterates in insertion order, so re-inserting on use keeps the least recent first.
	const entries = new Map<string, { value: V; expiresAt: number }>()
	return {
		get(key) {
			const entry = entries.get(key)
			if (!entry) {
				return undefined
			}
			entries.delete(key)
			if (entry.expiresAt <= now()) {
				return undefined
			}
			entries.set(key, entry)
			return entry.value
		},
		set(key, value, ttlMs) {
			entries.delete(key)
			if (!(ttlMs > 0)) {
				return
			}
			entries.set(key, { value, expiresAt: now() + ttlMs })
			for (const oldest of entries.keys()) {
				if (entries.size <= capacity) {
					break
				}
				entries.delete(oldest)
			}
		},
		delete(key) {
			entries.delete(key)
		},
		get size() {
			return entries.size
		},
	}
}
