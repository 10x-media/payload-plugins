import { describe, expect, it } from 'vitest'

import { resolveSSEOptions } from './options'

describe('resolveSSEOptions', () => {
	it('defaults heartbeatMs to 15000', () => {
		const resolved = resolveSSEOptions({})
		expect(resolved.heartbeatMs).toBe(15_000)
	})

	it('normalizes true collection entries to thinEvents true and all events', () => {
		const resolved = resolveSSEOptions({ collections: { posts: true } })
		expect(resolved.collections.posts).toEqual({
			thinEvents: true,
			events: ['create', 'update', 'delete'],
		})
	})

	it('fills missing events and thinEvents on object configs', () => {
		const resolved = resolveSSEOptions({
			collections: { posts: { events: ['create'] } },
		})
		expect(resolved.collections.posts).toEqual({
			thinEvents: true,
			events: ['create'],
		})
	})

	it('preserves custom heartbeatMs and broker', () => {
		const broker = {
			publish: () => {},
			subscribe: () => () => {},
			destroy: async () => {},
		}
		const resolved = resolveSSEOptions({ heartbeatMs: 5_000, broker })
		expect(resolved.heartbeatMs).toBe(5_000)
		expect(resolved.broker).toBe(broker)
	})

	it('stores presence and admin without using them', () => {
		const resolved = resolveSSEOptions({
			presence: true,
			admin: { liveList: true },
		})
		expect(resolved.presence).toBe(true)
		expect(resolved.admin).toEqual({ liveList: true })
	})
})
