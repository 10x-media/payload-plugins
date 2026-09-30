import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { assertContentUnlocked } from '../enforcement/assertUnlocked'
import { getContentLockState, isContentLocked } from './store'

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
