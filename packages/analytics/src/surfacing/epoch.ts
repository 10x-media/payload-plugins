import type { Payload } from 'payload'

export interface EpochStore {
	/** The scope's current epoch, served from an in-process memo inside the memo window. */
	get(scope?: string | null): Promise<number>
	/** Raises the scope's epoch, invalidating every cached read keyed on the old one. */
	bump(scope?: string | null): Promise<number>
}

export interface EpochStoreOptions {
	/** How long a read epoch is trusted in process; the upper bound on bump propagation. */
	memoMs?: number
	now?: () => number
}

const DEFAULT_MEMO_MS = 10_000

/**
 * KV key for a scope's counter. A null, undefined or empty scope is the install-wide
 * counter; every other scope, the platform wildcard included, gets its own. The scope is
 * encoded so no value can forge another key.
 */
export const epochKeyFor = (scope?: string | null): string =>
	`analytics:epoch:${scope === null || scope === undefined || scope === '' ? 'global' : encodeURIComponent(scope)}`

interface StoredEpoch {
	value: number
}

const readValue = (stored: StoredEpoch | null): number => {
	const value = stored?.value
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Per-scope cache epoch in `payload.kv`. Every cached analytics read carries its scope's
 * epoch in the key, so raising the counter retires that scope's entries at once on every
 * instance without deleting anything: the old keys simply stop being asked for and expire.
 *
 * Two concurrent bumps may read the same current value and land on the same new number.
 * That is harmless: any change of the number invalidates, and nothing reads the epoch as
 * a count of how many changes happened.
 */
export function createEpochStore(payload: Payload, opts: EpochStoreOptions = {}): EpochStore {
	const memoMs = opts.memoMs ?? DEFAULT_MEMO_MS
	const now = opts.now ?? Date.now
	const memo = new Map<string, { value: number; expiresAt: number }>()
	let warned = false

	return {
		async get(scope) {
			const key = epochKeyFor(scope)
			const at = now()
			const hit = memo.get(key)
			if (hit && hit.expiresAt > at) {
				return hit.value
			}
			let value = 0
			try {
				value = readValue(await payload.kv.get<StoredEpoch>(key))
			} catch (err) {
				// A read must never fail over an unreachable counter. Epoch 0 can only serve an
				// entry that is already TTL-bounded, and the failure is memoized like a hit so a
				// broken KV is asked once per window rather than once per read.
				if (!warned) {
					warned = true
					payload.logger.warn(
						`analytics: cache epoch read failed, falling back to epoch 0: ${String(err)}`
					)
				}
			}
			memo.set(key, { value, expiresAt: at + memoMs })
			return value
		},
		async bump(scope) {
			const key = epochKeyFor(scope)
			try {
				const next = readValue(await payload.kv.get<StoredEpoch>(key)) + 1
				await payload.kv.set(key, { value: next })
				memo.set(key, { value: next, expiresAt: now() + memoMs })
				return next
			} catch (err) {
				// Rethrown, unlike a failed get: a caller asking to invalidate has to learn that
				// the old numbers are still being served.
				payload.logger.warn(`analytics: cache epoch bump failed for "${key}": ${String(err)}`)
				throw err
			}
		},
	}
}
