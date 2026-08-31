import { describe, expect, it } from 'vitest'

import { resolveSSEOptions } from './options'

describe('resolveSSEOptions', () => {
	it('defaults maxConnectionsPerUser to 8', () => {
		expect(resolveSSEOptions({}).maxConnectionsPerUser).toBe(8)
	})

	it('preserves custom maxConnectionsPerUser', () => {
		expect(resolveSSEOptions({ maxConnectionsPerUser: 3 }).maxConnectionsPerUser).toBe(3)
	})

	it('clamps maxConnectionsPerUser and heartbeatMs to floors', () => {
		expect(resolveSSEOptions({ maxConnectionsPerUser: 0 }).maxConnectionsPerUser).toBe(1)
		expect(resolveSSEOptions({ heartbeatMs: 0 }).heartbeatMs).toBe(1_000)
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

	it('resolves presence true to defaults with name then email then id as label', () => {
		const resolved = resolveSSEOptions({ presence: true })
		expect(resolved.presence).not.toBe(false)
		if (resolved.presence === false) {
			throw new Error('expected presence enabled')
		}
		expect(resolved.presence.heartbeatMs).toBe(10_000)
		expect(resolved.presence.leaseMs).toBe(30_000)
		expect(resolved.presence.profile).toBe('none')
		expect(resolved.presence.identify({ id: 7, name: 'Ada', email: 'a@t.dev' })).toEqual({
			id: '7',
			label: 'Ada',
		})
		expect(resolved.presence.identify({ id: 7, email: 'a@t.dev' })).toEqual({
			id: '7',
			label: 'a@t.dev',
		})
		expect(resolved.presence.identify({ id: 7 })).toEqual({
			id: '7',
			label: '7',
		})
	})

	it('defaults presence.profile to none and preserves drawer or newTab', () => {
		expect(resolveSSEOptions({ presence: true }).presence).toMatchObject({ profile: 'none' })
		expect(resolveSSEOptions({ presence: { profile: 'drawer' } }).presence).toMatchObject({
			profile: 'drawer',
		})
		expect(resolveSSEOptions({ presence: { profile: 'newTab' } }).presence).toMatchObject({
			profile: 'newTab',
		})
	})

	it('fills missing presence object fields and resolves admin', () => {
		const identify = () => ({ id: 'x', label: 'X' })
		const resolved = resolveSSEOptions({
			presence: { heartbeatMs: 5_000, identify },
			admin: { liveList: true },
		})
		expect(resolved.presence).toEqual({
			heartbeatMs: 5_000,
			leaseMs: 30_000,
			identify,
			profile: 'none',
		})
		expect(resolved.admin).toEqual({ liveList: {}, presence: true })
	})

	it('resolves admin true with presence off to liveList only', () => {
		expect(resolveSSEOptions({ admin: true }).admin).toEqual({
			liveList: {},
			presence: false,
		})
		expect(resolveSSEOptions({ admin: true, presence: true }).admin).toEqual({
			liveList: {},
			presence: true,
		})
	})

	it('resolves admin.liveList field object', () => {
		expect(
			resolveSSEOptions({ admin: { liveList: { field: 'title' } }, presence: true }).admin
		).toEqual({ liveList: { field: 'title' }, presence: true })
	})

	it('leaves scope off when omitted or false', () => {
		expect(resolveSSEOptions({}).scope).toBe(false)
		expect(resolveSSEOptions({ scope: false }).scope).toBe(false)
	})

	it('resolves scope true to multiTenantScope resolvers', () => {
		const resolved = resolveSSEOptions({ scope: true })
		expect(resolved.scope).not.toBe(false)
		if (resolved.scope === false) {
			throw new Error('expected scope enabled')
		}
		expect(typeof resolved.scope.resolveRequest).toBe('function')
		expect(typeof resolved.scope.resolveDoc).toBe('function')
	})

	it('preserves a custom scope object', () => {
		const scope = {
			resolveRequest: () => 't1',
			resolveDoc: () => 't1',
		}
		const resolved = resolveSSEOptions({ scope })
		expect(resolved.scope).toBe(scope)
	})
})
