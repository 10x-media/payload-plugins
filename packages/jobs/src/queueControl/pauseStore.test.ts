import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { emptyPauseState } from './pauseState'
import { createPauseStore } from './pauseStore'

const makePayload = (kvValue: unknown): Payload => {
	return {
		kv: {
			get: async () => kvValue,
			set: async () => undefined,
		},
	} as unknown as Payload
}

describe('createPauseStore shape validation', () => {
	it('returns emptyPauseState when kv returns null', async () => {
		const store = createPauseStore(makePayload(null))
		expect(await store.getState()).toEqual(emptyPauseState())
	})

	it('returns emptyPauseState when kv returns undefined', async () => {
		const store = createPauseStore(makePayload(undefined))
		expect(await store.getState()).toEqual(emptyPauseState())
	})

	it('returns emptyPauseState when kv returns a non-object', async () => {
		const store = createPauseStore(makePayload('corrupt string'))
		expect(await store.getState()).toEqual(emptyPauseState())
	})

	it('returns emptyPauseState when kv returns an object missing global', async () => {
		const store = createPauseStore(makePayload({ queues: [] }))
		expect(await store.getState()).toEqual(emptyPauseState())
	})

	it('returns emptyPauseState when queues is null (corrupt shape)', async () => {
		const store = createPauseStore(makePayload({ global: false, queues: null }))
		expect(await store.getState()).toEqual(emptyPauseState())
	})

	it('returns the valid state when the shape is correct', async () => {
		const valid = { global: true, queues: ['emails'] }
		const store = createPauseStore(makePayload(valid))
		expect(await store.getState()).toEqual(valid)
	})
})
