import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { assertContentUnlocked } from '../enforcement/assertUnlocked'
import { CUSTOM_KEY, resolveOptions } from '../options'
import { getContentLockState, isContentLocked } from './store'
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
