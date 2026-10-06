import type { Payload } from 'payload'

export interface EpochStore {
	/** The scope's current epoch token, served from an in-process memo inside the window. */
	get(scope?: string | null): Promise<string>
	/** Retires the scope's cached reads by storing a token nothing has used before. */
	bump(scope?: string | null): Promise<string>
}

export interface EpochStoreOptions {
	/** How long a read epoch is trusted in process; the upper bound on bump propagation. */
	memoMs?: number
	now?: () => number
}

const DEFAULT_MEMO_MS = 10_000

/** The token a scope reads as until something bumps it, and after an unreadable get. */
export const INITIAL_EPOCH = '0'

/**
 * KV key for a scope's token. A null, undefined or empty scope is the install-wide token;
 * every other scope, the platform wildcard included, is keyed under its own `s:` prefix, so
 * a scope literally named `global` cannot reach the install-wide token. The scope is encoded
 * so no value can forge another key.
 */
export const epochKeyFor = (scope?: string | null): string =>
	scope === null || scope === undefined || scope === ''
		? 'analytics:epoch:global'
		: `analytics:epoch:s:${encodeURIComponent(scope)}`

interface StoredEpoch {
	value: string
}

const readValue = (stored: StoredEpoch | null): string => {
	const value = stored?.value
	return typeof value === 'string' && value !== '' ? value : INITIAL_EPOCH
}

/**
 * Per-scope cache epoch in `payload.kv`. Every cached analytics read carries its scope's
 * token in the key, so bumping retires that scope's entries at once on every instance
 * without deleting anything: the old keys simply stop being asked for and expire.
 *
 * The token is opaque and a bump writes a fresh one rather than incrementing. A
 * read-modify-write counter can move backwards under concurrent bumps and land on a value
 * whose entries are still live; a value never used before is always safe, and nothing reads
 * the token as a count of how many changes happened.
 */
export function createEpochStore(payload: Payload, opts: EpochStoreOptions = {}): EpochStore {
	const memoMs = opts.memoMs ?? DEFAULT_MEMO_MS
	const now = opts.now ?? Date.now
	const memo = new Map<string, { value: string; expiresAt: number }>()
	let warned = false

	const freshToken = (at: number): string => `${at.toString(36)}-${crypto.randomUUID().slice(0, 8)}`

	return {
		async get(scope) {
			const key = epochKeyFor(scope)
			const at = now()
			const hit = memo.get(key)
			if (hit && hit.expiresAt > at) {
				return hit.value
			}
			let value = INITIAL_EPOCH
			try {
				value = readValue(await payload.kv.get<StoredEpoch>(key))
			} catch (err) {
				// A read must never fail over an unreachable token. The failure is memoized like a
				// hit, so a broken KV is asked once per window rather than once per read; for that
				// window this instance may serve entries written before the last bump.
				if (!warned) {
					warned = true
					payload.logger?.warn(
						`analytics: cache epoch read failed, falling back to epoch ${INITIAL_EPOCH}: ${String(err)}`
					)
				}
			}
			memo.set(key, { value, expiresAt: at + memoMs })
			return value
		},
		async bump(scope) {
			const key = epochKeyFor(scope)
			const at = now()
			const next = freshToken(at)
			try {
				await payload.kv.set(key, { value: next })
				memo.set(key, { value: next, expiresAt: at + memoMs })
				return next
			} catch (err) {
				// Rethrown, unlike a failed get: a caller asking to invalidate has to learn that
				// the old numbers are still being served.
				payload.logger?.warn(`analytics: cache epoch bump failed for "${key}": ${String(err)}`)
				throw err
			}
		},
	}
}
