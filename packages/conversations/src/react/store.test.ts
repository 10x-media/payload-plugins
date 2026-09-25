import { describe, expect, it, vi } from 'vitest'

import type { SubscribeResponse } from '../shared/wire'
import type { ConversationsApi } from './api'
import { ConversationsStore } from './store'
import type { TransportConnection } from './transport'

const response = (keys: string[]): SubscribeResponse => ({
	channels: { internal: { label: 'Internal' } },
	deleted: 'placeholderIfReplies',
	entries: keys
		.filter((key) => key !== 'denied')
		.map((key) => ({
			channels: [{ canCreate: true, slug: 'internal' }],
			count: 1,
			key,
			token: `t:${key}`,
			unread: { internal: 1 },
		})),
	extensionData: {},
	extensions: [],
	now: '2026-01-01T00:00:00.000Z',
	reads: true,
	viewer: 'users:1',
})

const setup = () => {
	const subscribe = vi.fn(async (keys: string[]) => response(keys))
	const connection: TransportConnection = {
		destroy: vi.fn(),
		notify: vi.fn(),
		setActive: vi.fn(),
		watch: vi.fn(),
	}
	let onChange: (keys: string[]) => void = () => undefined
	const store = new ConversationsStore({
		api: { poll: vi.fn(), subscribe } as unknown as ConversationsApi,
		instance: 'comments',
		transport: {
			connect: (args) => {
				onChange = args.onChange
				return connection
			},
		},
	})
	store.connect()
	return { connection, fire: (keys: string[]) => onChange(keys), store, subscribe }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('conversations store', () => {
	it('coalesces mounts within a tick into one subscribe', async () => {
		const { connection, store, subscribe } = setup()
		store.retain('a')
		store.retain('b')
		store.retain('c')
		await tick()
		expect(subscribe).toHaveBeenCalledTimes(1)
		expect(subscribe).toHaveBeenCalledWith(['a', 'b', 'c'])
		expect(store.entry('b')?.unread).toEqual({ internal: 1 })
		expect(connection.watch).toHaveBeenLastCalledWith(
			[
				{ key: 'a', token: 't:a' },
				{ key: 'b', token: 't:b' },
				{ key: 'c', token: 't:c' },
			],
			'2026-01-01T00:00:00.000Z'
		)
	})

	it('marks keys the user may not see', async () => {
		const { store } = setup()
		store.retain('denied')
		await tick()
		expect(store.entry('denied')).toBeUndefined()
		expect(store.error('denied')?.message).toBe('Not found')
	})

	it('does not refetch a key remounted within the tick', async () => {
		const { store, subscribe } = setup()
		const release = store.retain('a')
		await tick()
		release()
		store.retain('a')
		await tick()
		expect(subscribe).toHaveBeenCalledTimes(1)
	})

	it('refreshes changed keys and notifies their listeners', async () => {
		const { fire, store, subscribe } = setup()
		store.retain('a')
		await tick()
		const listener = vi.fn()
		store.onChange('a', listener)
		fire(['a'])
		await tick()
		expect(listener).toHaveBeenCalledTimes(1)
		expect(subscribe).toHaveBeenCalledTimes(2)
	})

	it('counts active feeds across mounts', () => {
		const { connection, store } = setup()
		store.setActive('a', true)
		store.setActive('a', true)
		store.setActive('a', false)
		expect(connection.setActive).not.toHaveBeenCalledWith('a', false)
		store.setActive('a', false)
		expect(connection.setActive).toHaveBeenLastCalledWith('a', false)
	})
})
