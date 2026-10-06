import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { assertContentUnlocked } from '../enforcement/assertUnlocked'
import { CUSTOM_KEY, resolveOptions } from '../options'
import {
	getContentLockState,
	isContentLocked,
	readWindows,
	rebuildSnapshot,
	SNAPSHOT_KEY,
} from './store'
import type { LockWindow } from './types'

/** A config the plugin never ran on: disabled for this environment, or not installed. */
const withoutPlugin = { config: { custom: {} } } as unknown as Payload

describe('lock state without the plugin', () => {
	it('reports nothing locked instead of throwing', async () => {
		expect((await getContentLockState(withoutPlugin)).locked).toBe(false)
		expect(await isContentLocked(withoutPlugin)).toBe(false)
		expect(await isContentLocked(withoutPlugin, { collection: 'posts' })).toBe(false)
		const req = { payload: withoutPlugin, context: {} } as unknown as PayloadRequest
		await expect(assertContentUnlocked(req, { collection: 'posts' })).resolves.toBeUndefined()
	})
})

type Doc = Record<string, unknown>

/** Published, started and ending manually, so active whatever the clock says. */
const ACTIVE: Doc = { id: 'w1', title: 'Migration', startsAt: '2026-01-01T00:00:00.000Z' }

/** What Redis answers a SET without TTL at maxmemory under `volatile-lru`, while GETs still work. */
const OOM = new Error("OOM command not allowed when used memory > 'maxmemory'.")

const snapshot = (ageMs: number, windows: LockWindow[] = []) => ({
	version: 1,
	builtAt: new Date(Date.now() - ageMs).toISOString(),
	windows,
})

const ids = (windows: LockWindow[]) => windows.map((window) => window.id)

/** A Payload with the plugin installed, `docs` in the lock collection and an empty, working kv. */
const fakePayload = (docs: Doc[] = []) => {
	const db = {
		find: vi.fn<(args: { req?: PayloadRequest }) => Promise<{ docs: Doc[] }>>(async () => ({
			docs,
		})),
	}
	const kv = {
		get: vi.fn<(key: string) => Promise<unknown>>(async () => null),
		set: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => undefined),
	}
	const logger = { error: vi.fn() }
	const config = { custom: { [CUSTOM_KEY]: resolveOptions({}) } }
	const payload = { config, db, kv, logger } as unknown as Payload
	return { db, kv, logger, payload }
}

const burst = <T>(read: () => Promise<T>) => Promise.all(Array.from({ length: 150 }, read))

describe('lock state when kv rejects writes', () => {
	it('enforces the windows read from the collection and holds them in memory', async () => {
		const { db, kv, logger, payload } = fakePayload([ACTIVE])
		kv.set.mockRejectedValue(OOM)
		const state = await getContentLockState(payload)
		expect(state.locked).toBe(true)
		expect(ids(state.active)).toEqual(['w1'])
		expect(logger.error).toHaveBeenCalledOnce()
		expect((await getContentLockState(payload)).locked).toBe(true)
		expect(db.find).toHaveBeenCalledOnce()
	})

	it('lets writes through when no window is active', async () => {
		const { kv, payload } = fakePayload()
		kv.set.mockRejectedValue(OOM)
		const req = { payload, context: {} } as unknown as PayloadRequest
		await expect(assertContentUnlocked(req, { collection: 'posts' })).resolves.toBeUndefined()
	})
})

describe('concurrent reads of the lock state', () => {
	it('share one kv read', async () => {
		const { kv, payload } = fakePayload()
		kv.get.mockResolvedValue(snapshot(0))
		await burst(() => getContentLockState(payload))
		expect(kv.get).toHaveBeenCalledOnce()
	})

	it('share one rebuild of a stale snapshot', async () => {
		const { db, kv, payload } = fakePayload([ACTIVE])
		kv.get.mockResolvedValue(snapshot(5 * 60_000))
		const states = await burst(() => getContentLockState(payload))
		expect(states.every((state) => state.locked)).toBe(true)
		expect(db.find).toHaveBeenCalledOnce()
		expect(kv.set).toHaveBeenCalledOnce()
	})

	it('share a failed read, and the next read starts over', async () => {
		const { db, payload } = fakePayload()
		db.find.mockRejectedValueOnce(new Error('connection reset'))
		const settled = await Promise.allSettled([1, 2, 3].map(() => readWindows(payload)))
		expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
		expect(db.find).toHaveBeenCalledOnce()
		await expect(readWindows(payload)).resolves.toEqual([])
		expect(db.find).toHaveBeenCalledTimes(2)
	})

	it('leave a window write that lands meanwhile with its own windows', async () => {
		const { db, kv, payload } = fakePayload()
		let finishEarlierRead: (result: { docs: Doc[] }) => void = () => undefined
		db.find
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finishEarlierRead = resolve
					})
			)
			.mockResolvedValueOnce({ docs: [ACTIVE] })
		const earlier = readWindows(payload)
		await vi.waitFor(() => expect(db.find).toHaveBeenCalledOnce())

		const req = { payload } as unknown as PayloadRequest
		expect(ids(await rebuildSnapshot(payload, req))).toEqual(['w1'])
		expect(db.find).toHaveBeenLastCalledWith(expect.objectContaining({ req }))

		finishEarlierRead({ docs: [] })
		expect(await earlier).toEqual([])
		expect(ids(await readWindows(payload))).toEqual(['w1'])
		expect(kv.set).toHaveBeenLastCalledWith(
			SNAPSHOT_KEY,
			expect.objectContaining({ windows: [expect.objectContaining({ id: 'w1' })] })
		)
	})
})
