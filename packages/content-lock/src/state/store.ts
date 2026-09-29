import { type CollectionSlug, getCurrentDate, type Payload, type PayloadRequest } from 'payload'

import { resumeWindowJobs } from '../jobs/deferred'
import { optionsFromConfig } from '../options'
import { isEntityLocked, resolveState, statusOf } from './resolve'
import type { ContentLockState, LockWindow } from './types'
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

const memory = new WeakMap<Payload, { readAt: number; windows: LockWindow[] }>()

const isSnapshot = (value: unknown): value is Snapshot =>
	typeof value === 'object' &&
	value !== null &&
	(value as Snapshot).version === 1 &&
	Array.isArray((value as Snapshot).windows)

/**
 * Rebuild the snapshot from the collection and store it in kv. Only published
 * windows count: a draft locks and announces nothing. Pass the request of an
 * in-flight write so the read sees that write's transaction.
 */
export const rebuildSnapshot = async (
	payload: Payload,
	req?: PayloadRequest
): Promise<LockWindow[]> => {
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
	const snapshot: Snapshot = { version: 1, builtAt: now.toISOString(), windows }
	await payload.kv.set(SNAPSHOT_KEY, snapshot)
	memory.set(payload, { readAt: Date.now(), windows })
	return windows
}

/** The windows in the stored snapshot, however old; empty when there is none. */
export const readStoredWindows = async (payload: Payload): Promise<LockWindow[]> => {
	const stored = await payload.kv.get<Snapshot>(SNAPSHOT_KEY)
	return isSnapshot(stored) ? stored.windows : []
}

/** Current windows: process memory, then kv, then the collection. */
export const readWindows = async (payload: Payload): Promise<LockWindow[]> => {
	const cached = memory.get(payload)
	if (cached && Date.now() - cached.readAt < MEMORY_TTL_MS) {
		return cached.windows
	}
	const stored = await payload.kv.get<Snapshot>(SNAPSHOT_KEY)
	if (
		isSnapshot(stored) &&
		getCurrentDate().getTime() - Date.parse(stored.builtAt) < SNAPSHOT_MAX_AGE_MS
	) {
		memory.set(payload, { readAt: Date.now(), windows: stored.windows })
		return stored.windows
	}
	return healSnapshot(payload, isSnapshot(stored) ? stored.windows : [])
}

/**
 * Rebuild the snapshot outside a window write (at startup, or when it went
 * stale). Windows live in `previous` but gone now (ended, deleted, or edited
 * in the database) release the jobs they deferred, in case the release that
 * should have followed their change never ran. Costs nothing unless one went.
 */
export const healSnapshot = async (
	payload: Payload,
	previous: LockWindow[]
): Promise<LockWindow[]> => {
	const windows = await rebuildSnapshot(payload)
	const live = new Set(windows.map((window) => window.id))
	for (const window of previous) {
		if (!live.has(window.id)) {
			await resumeWindowJobs(payload, window.id)
		}
	}
	return windows
}

/** Drop this process's in-memory copy so the next read goes to kv. */
export const forgetWindows = (payload: Payload): void => {
	memory.delete(payload)
}

/** The effective lock at the current instant (Payload's clock, so tests can move it). */
export const getContentLockState = async (payload: Payload): Promise<ContentLockState> => {
	const { exempt, groups } = optionsFromConfig(payload.config)
	return resolveState(await readWindows(payload), getCurrentDate(), { exempt, groups })
}

/**
 * Whether content is locked right now: any of it, or the given collection,
 * global or custom target. Exempt collections and globals never are. For jobs
 * and other server code that would rather skip or postpone work than have its
 * writes rejected, and for anything a custom target stands for.
 */
export const isContentLocked = async (
	payload: Payload,
	target?: { collection: string } | { global: string } | { custom: string }
): Promise<boolean> => {
	const state = await getContentLockState(payload)
	if (!target) {
		return state.locked
	}
	if ('collection' in target) {
		return isEntityLocked(state, { type: 'collection', slug: target.collection })
	}
	if ('global' in target) {
		return isEntityLocked(state, { type: 'global', slug: target.global })
	}
	return isEntityLocked(state, { type: 'custom', slug: target.custom })
}
