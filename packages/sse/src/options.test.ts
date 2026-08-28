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

	it('leaves presence off when omitted or false', () => {
		expect(resolveSSEOptions({}).presence).toBe(false)
		expect(resolveSSEOptions({ presence: false }).presence).toBe(false)
	})

	it('resolves presence true to defaults without email identify', () => {
		const resolved = resolveSSEOptions({ presence: true })
		expect(resolved.presence).not.toBe(false)
		if (resolved.presence === false) {
			throw new Error('expected presence enabled')
		}
		expect(resolved.presence.heartbeatMs).toBe(10_000)
		expect(resolved.presence.leaseMs).toBe(30_000)
		expect(resolved.presence.identify({ id: 7, email: 'a@t.dev' })).toEqual({
			id: '7',
			label: '7',
		})
	})

	it('fills missing presence object fields and preserves admin', () => {
		const identify = () => ({ id: 'x', label: 'X' })
		const resolved = resolveSSEOptions({
			presence: { heartbeatMs: 5_000, identify },
			admin: { liveList: true },
		})
		expect(resolved.presence).toEqual({
			heartbeatMs: 5_000,
			leaseMs: 30_000,
			identify,
		})
		expect(resolved.admin).toEqual({ liveList: true })
	})
})
