import type { Payload } from 'payload'
import type { CacheKeyEpochs } from '../core/cacheKey'
import { currentTime } from '../core/clock'
import { remember } from './bounded'

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
	/** Where the tokens are kept; `payload.kv` under {@link epochKeyFor} by default. */
	backend?: EpochBackend
}

const DEFAULT_MEMO_MS = 10_000

/** The token a scope reads as until something bumps it. */
export const INITIAL_EPOCH = '0'

/** The configuration epoch of a scope on an install whose providers and goals live in code. */
export const FIXED_CONFIG_EPOCH = '0'

/** Scopes one fallback remembers a last good epoch for, before it forgets them all at once. */
const FALLBACK_SCOPES = 10_000

/** A token no read has keyed on before: `<base36 time>-<8 random hex>`. */
const freshToken = (at: number): string => `${at.toString(36)}-${crypto.randomUUID().slice(0, 8)}`

/**
 * What a scope keys on while its epoch is unreadable: its last epoch read here, else one token per
 * outage. Never a constant shared across outages, which would mix two configurations' numbers.
 */
export interface EpochFallback {
	/** Records `epoch`, read now, as the scope's last good one and ends its outage; answers it. */
	read(scope: string | null | undefined, epoch: string): string
	/** The scope's last good epoch, else its outage's token. */
	failed(scope: string | null | undefined): string
	/** The scope's outage's token alone: for answers built differently while the read fails. */
	outage(scope: string | null | undefined): string
}

export const createEpochFallback = (now: () => number = currentTime): EpochFallback => {
	const good = new Map<string, string>()
	const outages = new Map<string, string>()
	const keyOf = (scope: string | null | undefined): string => scope ?? ''
	const outage = (scope: string | null | undefined): string => {
		const key = keyOf(scope)
		const known = outages.get(key)
		if (known !== undefined) {
			return known
		}
		if (outages.size >= FALLBACK_SCOPES) {
			outages.clear()
		}
		const token = `outage-${freshToken(now())}`
		outages.set(key, token)
		return token
	}
	return {
		read(scope, epoch) {
			const key = keyOf(scope)
			if (good.size >= FALLBACK_SCOPES && !good.has(key)) {
				good.clear()
			}
			good.set(key, epoch)
			outages.delete(key)
			return epoch
		},
		failed: (scope) => good.get(keyOf(scope)) ?? outage(scope),
		outage,
	}
}

/** Where a scope's two key epochs come from; either left out reads as its fixed starting value. */
export interface EpochSources {
	refresh?: Pick<EpochStore, 'get'>
	/** The scope's provider and goal configuration epoch. */
	config?: (scope?: string | null) => Promise<string>
}

/** Both epochs a scope's cache keys carry right now. */
export const epochsFor = async (
	sources: EpochSources,
	scope?: string | null
): Promise<CacheKeyEpochs> => {
	const [config, refresh] = await Promise.all([
		sources.config?.(scope) ?? FIXED_CONFIG_EPOCH,
		sources.refresh?.get(scope) ?? INITIAL_EPOCH,
	])
	return { config, refresh }
}

/**
 * A scope's key under `prefix`; an empty scope is install-wide. Every other scope is encoded under
 * an `s:` prefix, so no scope name (`global` included) can reach or forge another's key.
 */
const scopedKey = (prefix: string, scope?: string | null): string =>
	scope === null || scope === undefined || scope === ''
		? `${prefix}:global`
		: `${prefix}:s:${encodeURIComponent(scope)}`

/** KV key for a scope's refresh token. */
export const epochKeyFor = (scope?: string | null): string => scopedKey('analytics:epoch', scope)

/** KV key for a scope's configuration token, keyed as {@link epochKeyFor} keys the refresh one. */
export const configEpochKeyFor = (scope?: string | null): string =>
	scopedKey('analytics:config-epoch', scope)

interface StoredEpoch {
	value: string
}

const readValue = (stored: StoredEpoch | null): string => {
	const value = stored?.value
	return typeof value === 'string' && value !== '' ? value : INITIAL_EPOCH
}

/** Where a store keeps each scope's token. */
export interface EpochBackend {
	/** The scope's token, the initial one while none was ever stored. */
	get(scope?: string | null): Promise<string>
	set(scope: string | null | undefined, token: string): Promise<void>
}

/** Tokens in `payload.kv`, under the keys `keyFor` names. */
export const kvEpochBackend = (
	payload: Payload,
	keyFor: (scope?: string | null) => string = epochKeyFor
): EpochBackend => ({
	get: async (scope) => readValue(await payload.kv.get<StoredEpoch>(keyFor(scope))),
	set: async (scope, token) => {
		await payload.kv.set(keyFor(scope), { value: token })
	},
})

/**
 * Per-scope cache epoch carried in every cache key, so a bump retires a scope's entries everywhere
 * without deleting. Bumps write a fresh opaque token, since a counter can move backwards in a race.
 */
export function createEpochStore(payload: Payload, opts: EpochStoreOptions = {}): EpochStore {
	const memoMs = opts.memoMs ?? DEFAULT_MEMO_MS
	const now = opts.now ?? currentTime
	const backend = opts.backend ?? kvEpochBackend(payload)
	const memo = new Map<string, { value: string; expiresAt: number }>()
	const fallback = createEpochFallback(now)
	let warned = false

	return {
		async get(scope) {
			const key = epochKeyFor(scope)
			const at = now()
			const hit = memo.get(key)
			if (hit && hit.expiresAt > at) {
				return hit.value
			}
			let value: string
			try {
				value = fallback.read(scope, await backend.get(scope))
			} catch (err) {
				// A read never fails over an unreachable token; the failure is memoized like a hit, so a
				// broken store is asked once per window, not once per read.
				value = fallback.failed(scope)
				if (!warned) {
					warned = true
					payload.logger?.warn(
						`analytics: cache epoch read failed, falling back to the last epoch this instance read: ${String(err)}`
					)
				}
			}
			remember(memo, [key, { value, expiresAt: at + memoMs }])
			return value
		},
		async bump(scope) {
			const key = epochKeyFor(scope)
			const at = now()
			const next = freshToken(at)
			try {
				await backend.set(scope, next)
				remember(memo, [key, { value: fallback.read(scope, next), expiresAt: at + memoMs }])
				return next
			} catch (err) {
				// Rethrown, unlike a failed get: a caller asking to invalidate has to learn that
				// the old numbers are still being served.
				payload.logger?.warn(
					`analytics: cache epoch bump failed for scope "${scope || 'global'}": ${String(err)}`
				)
				throw err
			}
		},
	}
}
