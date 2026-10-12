import type { Payload } from 'payload'
import { dbKind, knownDbKind } from '../db/kind'
import { nativeInstanceOf } from '../native/engine/instance'
import { createSqlExecutor } from '../native/store/sql/executor'
import { leaseKey } from '../native/store/state'
import { createStateStore } from '../native/store/stateStore'
import type { TaskStateStore } from '../native/store/types'
import { slugOfRole } from '../plugin/collectionChecks'
import { afterDestroy } from '../plugin/destroy'
import { getRuntime } from '../plugin/runtime'
import { apiTaskState } from './apiTaskState'
import type { Lease } from './underLease'

export { type Lease, type LeaseHold, type LeaseOutcome, underLease } from './underLease'

/**
 * Sync and warm lease length between renewals (renewed every third), so a killed run lets the next
 * in within this, or twice this on a database the plugin runs no SQL on (Cloudflare D1).
 */
export const TASK_LEASE_MS = 2 * 60_000

/** The state store of an install without `native()`, one per database adapter, with its slug. */
const standalone = new WeakMap<object, { slug: string; store: TaskStateStore }>()

/**
 * The plugin's own store on `analytics-state`, on the main thread since it only claims leases and
 * stamps heartbeats and cursors; where it runs no SQL (D1), it uses Payload's database API.
 */
const standaloneStore = (payload: Payload, slug: string): TaskStateStore => {
	const known = standalone.get(payload.db)
	if (known?.slug === slug) {
		return known.store
	}
	let built: TaskStateStore | undefined
	if (knownDbKind(payload) !== undefined) {
		try {
			const executor =
				dbKind(payload) === 'mongo' ? undefined : createSqlExecutor(payload, { thread: 'main' })
			built = createStateStore(payload, { slug, ...(executor ? { executor } : {}) })
			if (executor) {
				afterDestroy(payload, executor, () => executor.close())
			}
		} catch (err) {
			payload.logger?.warn(
				`analytics: the sync and warm tasks keep their leases through Payload's database API, since the plugin cannot reach this database itself: ${String(err)}`
			)
		}
	}
	const store = built ?? apiTaskState(payload, { slug })
	standalone.set(payload.db, { slug, store })
	return store
}

/**
 * An instance's `analytics-state` store: the native engine's where it runs one, else the plugin's
 * own; undefined on an install keeping no such collection.
 */
export const stateStoreOf = (payload: Payload): TaskStateStore | undefined => {
	const native = nativeInstanceOf(payload)?.state
	if (native) {
		return native
	}
	// Found by role, whatever they were renamed to.
	const collections = payload.config?.collections
	const slug = slugOfRole(collections, 'state')
	if (slug === undefined) {
		return undefined
	}
	if (slugOfRole(collections, 'hits') !== undefined) {
		// The native engine keeps it, and a second store would be a second executor on its tables. A
		// worker that has run nothing yet (a schedule's guard) builds its runtime, which attaches it.
		getRuntime(payload)
		return nativeInstanceOf(payload)?.state
	}
	return standaloneStore(payload, slug)
}

/**
 * The lease `lease:<name>` with an owner of its own, on the instance's state store. Undefined
 * where there is none. Asked for again for each piece of work, since a reload replaces the engine.
 */
export const stateLease = (payload: Payload, name: string, ttlMs: number): Lease | undefined => {
	const state = stateStoreOf(payload)
	if (!state) {
		return undefined
	}
	const key = leaseKey(name)
	const owner = `${name}:${crypto.randomUUID()}`
	return {
		claim: () => state.claim(key, owner, ttlMs),
		release: async () => {
			await state.release(key, owner)
		},
	}
}

/** Whether a live holder has `lease:<name>`; undefined where the instance keeps no state store. */
export const leaseHeld = async (payload: Payload, name: string): Promise<boolean | undefined> =>
	stateStoreOf(payload)?.held(leaseKey(name))
