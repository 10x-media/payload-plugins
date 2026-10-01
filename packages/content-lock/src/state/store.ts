import { type CollectionSlug, getCurrentDate, type Payload, type PayloadRequest } from 'payload'

import { resumeWindowJobs } from '../jobs/deferred'
import { optionsFromConfig, storedOptionsOf } from '../options'
import { entityOf, isEntityLocked, resolveState, statusOf } from './resolve'
import type { ContentLockState, ContentLockTarget, LockWindow } from './types'
import { toWindow } from './window'

export const SNAPSHOT_KEY = '@10x-media/content-lock:snapshot'

/** How long a process trusts its in-memory copy before reading kv again. */
const MEMORY_TTL_MS = 2_000

/**
 * How old a kv snapshot may get before a reader rebuilds it from the
 * collection. Heals a snapshot left stale by writes that bypassed the hooks
 * (a direct database edit, a rolled back transaction).
 */
const SNAPSHOT_MAX_AGE_MS = 60_000

type Snapshot = { version: 1; builtAt: string; windows: LockWindow[] }

/**
 * What this process holds for one Payload instance. A window write replaces
 * it, so a read that began before the write settles into the old one and
 * cannot store its older windows over the write's.
 */
type Memory = {
	/** The windows last read, trusted for `MEMORY_TTL_MS` after `readAt`. */
	cached?: { readAt: number; windows: LockWindow[] }
	/** The read in flight, which every caller shares until it settles. */
	reading?: Promise<LockWindow[]>
}

const memory = new WeakMap<Payload, Memory>()

const memoryOf = (payload: Payload): Memory => {
	let held = memory.get(payload)
	if (!held) {
		held = {}
		memory.set(payload, held)
	}
	return held
}

const isSnapshot = (value: unknown): value is Snapshot =>
	typeof value === 'object' &&
	value !== null &&
	(value as Snapshot).version === 1 &&
	Array.isArray((value as Snapshot).windows)

/**
 * A snapshot of the collection as it is now. Only published windows count: a
 * draft locks and announces nothing.
 */
const readCollection = async (payload: Payload, req?: PayloadRequest): Promise<Snapshot> => {
	const { slug } = optionsFromConfig(payload.config)
	// Straight from the adapter: collection hooks (the live status field reads
	// this snapshot) must not run while it is being built.
	const { docs } = await payload.db.find({
		collection: slug as CollectionSlug,
		limit: 0,
		pagination: false,
		req,
		where: { and: [{ _status: { equals: 'published' } }, { endedAt: { exists: false } }] },
	})
	const now = getCurrentDate()
	const windows = docs
		.map((doc) => toWindow(doc as unknown as Record<string, unknown>))
		.filter((window) => statusOf(window, now) !== 'ended')
	return { version: 1, builtAt: now.toISOString(), windows }
}

/**
 * Rebuild the snapshot after a window write and store it in kv. Pass the
 * write's request so the read sees its transaction. A kv error throws and
 * fails the write: other servers would go on enforcing the old snapshot for up
 * to `SNAPSHOT_MAX_AGE_MS`, so the write must not report a change they cannot see.
 */
export const rebuildSnapshot = async (
	payload: Payload,
	req: PayloadRequest
): Promise<LockWindow[]> => {
	const snapshot = await readCollection(payload, req)
	// Swapped in just before the kv write, so a read still in flight skips its own kv write and no
	// older snapshot can follow this one into kv.
	const held: Memory = {}
	memory.set(payload, held)
	await payload.kv.set(SNAPSHOT_KEY, snapshot)
	held.cached = { readAt: Date.now(), windows: snapshot.windows }
	return snapshot.windows
}

/** The windows in the stored snapshot, however old; empty when there is none. */
export const readStoredWindows = async (payload: Payload): Promise<LockWindow[]> => {
	const stored = await payload.kv.get<Snapshot>(SNAPSHOT_KEY)
	return isSnapshot(stored) ? stored.windows : []
}

/**
 * Current windows: process memory, then kv, then the collection. Concurrent
 * callers share one read, so a burst (an admin page resolving the access of
 * every collection at once) costs one kv read and at most one rebuild. A
 * failed read rejects the callers that shared it; the next call starts over.
 */
export const readWindows = async (payload: Payload): Promise<LockWindow[]> => {
	const held = memoryOf(payload)
	if (held.cached && Date.now() - held.cached.readAt < MEMORY_TTL_MS) {
		return held.cached.windows
	}
	held.reading ??= loadWindows(payload, held).finally(() => {
		held.reading = undefined
	})
	return held.reading
}

const loadWindows = async (payload: Payload, held: Memory): Promise<LockWindow[]> => {
	const stored = await payload.kv.get<Snapshot>(SNAPSHOT_KEY)
	if (
		isSnapshot(stored) &&
		getCurrentDate().getTime() - Date.parse(stored.builtAt) < SNAPSHOT_MAX_AGE_MS
	) {
		held.cached = { readAt: Date.now(), windows: stored.windows }
		return stored.windows
	}
	return heal(payload, isSnapshot(stored) ? stored.windows : [], held)
}

/**
 * Rebuild the snapshot outside a window write, when it is missing or went
 * stale. A kv error is only logged: the windows are known, so this process
 * enforces them and the next rebuild retries the store. Windows in `previous`
 * but gone now (ended, deleted, or edited in the database) release the jobs
 * they deferred, in case the release that should have followed their change
 * never ran. Costs nothing unless one went.
 */
const heal = async (
	payload: Payload,
	previous: LockWindow[],
	held: Memory
): Promise<LockWindow[]> => {
	const snapshot = await readCollection(payload)
	// A window write since this read began has stored newer windows; storing these would undo it.
	if (memory.get(payload) === held) {
		try {
			await payload.kv.set(SNAPSHOT_KEY, snapshot)
		} catch (error) {
			payload.logger.error({
				err: error,
				msg: '[content-lock] cannot store the lock snapshot, enforcing the windows read from the collection',
			})
		}
		held.cached = { readAt: Date.now(), windows: snapshot.windows }
	}
	const live = new Set(snapshot.windows.map((window) => window.id))
	for (const window of previous) {
		if (!live.has(window.id)) {
			await resumeWindowJobs(payload, window.id)
		}
	}
	return snapshot.windows
}

/** Rebuild the snapshot at startup, releasing the jobs of windows gone from `previous`. */
export const healSnapshot = (payload: Payload, previous: LockWindow[]): Promise<LockWindow[]> =>
	heal(payload, previous, memoryOf(payload))

/** Drop what this process holds, so the next read goes to kv. A read in flight settles unseen. */
export const forgetWindows = (payload: Payload): void => {
	memory.delete(payload)
}

/** The effective lock at the current instant (Payload's clock, so tests can move it). */
export const getContentLockState = async (payload: Payload): Promise<ContentLockState> => {
	const options = storedOptionsOf(payload.config)
	// Disabled for this environment, or not installed: nothing is locked, so host code can ask anyway.
	if (!options) {
		return resolveState([], getCurrentDate(), { groups: [] })
	}
	return resolveState(await readWindows(payload), getCurrentDate(), {
		exempt: options.exempt,
		groups: options.groups,
	})
}

/**
 * Whether content is locked right now: any of it, or the given collection,
 * global or custom target. Exempt collections and globals never are. For jobs
 * and other server code that would rather skip or postpone work than have its
 * writes rejected, and for anything a custom target stands for.
 */
export const isContentLocked = async (
	payload: Payload,
	target?: ContentLockTarget
): Promise<boolean> => {
	const state = await getContentLockState(payload)
	return target ? isEntityLocked(state, entityOf(target)) : state.locked
}
