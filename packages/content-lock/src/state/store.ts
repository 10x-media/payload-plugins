import { type CollectionSlug, getCurrentDate, type Payload, type PayloadRequest } from 'payload'

import { optionsFromConfig } from '../options'
import { resolveState, statusOf } from './resolve'
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
 * Rebuild the snapshot from the collection and store it in kv. Pass the
 * request of an in-flight write so the read sees that write's transaction.
 */
export const rebuildSnapshot = async (
	payload: Payload,
	req?: PayloadRequest
): Promise<LockWindow[]> => {
	const { slug } = optionsFromConfig(payload.config)
	const { docs } = await payload.find({
		collection: slug as CollectionSlug,
		depth: 0,
		limit: 0,
		overrideAccess: true,
		pagination: false,
		req,
		where: { endedAt: { exists: false } },
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
	return rebuildSnapshot(payload)
}

/** Drop this process's in-memory copy so the next read goes to kv. */
export const forgetWindows = (payload: Payload): void => {
	memory.delete(payload)
}

/** The effective lock at the current instant (Payload's clock, so tests can move it). */
export const getContentLockState = async (payload: Payload): Promise<ContentLockState> => {
	const { groups } = optionsFromConfig(payload.config)
	return resolveState(await readWindows(payload), getCurrentDate(), groups)
}
