import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PollResponse } from '../shared/wire'
import { createPoller, type PollerEnv } from './poller'

const IDLE = 60_000
const ACTIVE = 15_000

/** One browser: a lock manager and channels shared by every tab created from it. */
const browser = () => {
	type Handler = (event: MessageEvent) => void
	const channels = new Map<string, Set<{ onmessage: Handler | null }>>()
	const holders = new Map<string, boolean>()
	const queues = new Map<string, Array<() => void>>()
	/** What the server reports as changed on the next poll. */
	let changed: string[] = []
	let expired: string[] = []

	const locks = {
		request: (
			name: string,
			options: { signal?: AbortSignal },
			callback: () => Promise<void> | undefined
		) =>
			new Promise<void>((resolve, reject) => {
				const run = async () => {
					holders.set(name, true)
					await callback()
					holders.set(name, false)
					resolve()
					queues.get(name)?.shift()?.()
				}
				if (!holders.get(name)) {
					void run()
					return
				}
				const queue = queues.get(name) ?? []
				const entry = () => void run()
				queue.push(entry)
				queues.set(name, queue)
				options.signal?.addEventListener('abort', () => {
					queue.splice(queue.indexOf(entry), 1)
					reject(new DOMException('aborted', 'AbortError'))
				})
			}),
	} as unknown as NonNullable<PollerEnv['locks']>

	const openChannel = (name: string) => {
		const peers = channels.get(name) ?? new Set()
		channels.set(name, peers)
		const channel = {
			close: () => peers.delete(channel),
			onmessage: null as Handler | null,
			postMessage: (data: unknown) => {
				for (const peer of peers) {
					if (peer !== channel) queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent))
				}
			},
		}
		peers.add(channel)
		return channel
	}

	const tab = ({ shared = true, visible = true } = {}) => {
		let isVisible = visible
		const listeners = new Set<() => void>()
		const changes: string[][] = []
		const expiries: string[][] = []
		const poll = vi.fn(
			async (body: { since: string; tokens: string[] }): Promise<PollResponse> => ({
				changed: [...changed],
				expired: body.tokens.filter((token) => expired.includes(token)),
				now: new Date(Date.now()).toISOString(),
			})
		)
		const poller = createPoller({
			env: {
				...(shared ? { locks, openChannel } : {}),
				clearTimeout: (timer) => clearTimeout(timer),
				isVisible: () => isVisible,
				now: () => Date.now(),
				onVisibilityChange: (listener) => {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				setTimeout: (callback, ms) => setTimeout(callback, ms),
			},
			instance: 'comments',
			intervals: { active: ACTIVE, idle: IDLE },
			onChange: (keys) => changes.push(keys),
			onExpired: (keys) => expiries.push(keys),
			poll,
		})
		return {
			changes,
			expiries,
			poll,
			poller,
			setVisible: (next: boolean) => {
				isVisible = next
				for (const listener of listeners) listener()
			},
			watch: (...keys: string[]) =>
				poller.watch(
					keys.map((key) => ({ key, token: `t:${key}` })),
					new Date(Date.now()).toISOString()
				),
		}
	}

	return {
		expire: (tokens: string[]) => {
			expired = tokens
		},
		serverChanges: (keys: string[]) => {
			changed = keys
		},
		tab,
	}
}

const polledKeys = (t: { poll: ReturnType<typeof vi.fn> }) =>
	t.poll.mock.calls.flatMap(([body]) => (body as { tokens: string[] }).tokens)

describe('poller', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('polls a key shown in two visible tabs once, and both hear the change', async () => {
		const b = browser()
		const one = b.tab()
		const two = b.tab()
		one.watch('a')
		two.watch('a')
		b.serverChanges(['a'])
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(one.poll.mock.calls.length + two.poll.mock.calls.length).toBe(1)
		expect(one.changes).toEqual([['a']])
		expect(two.changes).toEqual([['a']])
	})

	it('polls every led key in one request', async () => {
		const b = browser()
		const one = b.tab()
		one.watch('a', 'b', 'c')
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(one.poll).toHaveBeenCalledTimes(1)
		expect(polledKeys(one)).toEqual(['t:a', 't:b', 't:c'])
	})

	it('hands a key over when its leader is hidden, keeping the clock', async () => {
		const b = browser()
		const one = b.tab()
		one.watch('a')
		await vi.advanceTimersByTimeAsync(0)
		const two = b.tab()
		two.watch('a')
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(one.poll).toHaveBeenCalledTimes(1)
		expect(two.poll).toHaveBeenCalledTimes(0)

		one.setVisible(false)
		await vi.advanceTimersByTimeAsync(0)
		// The new leader waits out the old one's interval rather than polling on arrival.
		expect(two.poll).toHaveBeenCalledTimes(0)
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(two.poll).toHaveBeenCalledTimes(1)
		expect(one.poll).toHaveBeenCalledTimes(1)
	})

	it('does not poll while no tab is visible', async () => {
		const b = browser()
		const one = b.tab({ visible: false })
		one.watch('a')
		await vi.advanceTimersByTimeAsync(IDLE * 3)
		expect(one.poll).not.toHaveBeenCalled()
		// Back after longer than an interval: the check is overdue, so it runs at once.
		one.setVisible(true)
		await vi.advanceTimersByTimeAsync(0)
		expect(one.poll).toHaveBeenCalledTimes(1)
	})

	it('polls faster while a feed is open in any tab', async () => {
		const b = browser()
		const leader = b.tab()
		leader.watch('a')
		await vi.advanceTimersByTimeAsync(0)
		const other = b.tab()
		other.watch('a')
		other.poller.setActive('a', true)
		await vi.advanceTimersByTimeAsync(ACTIVE)
		expect(leader.poll).toHaveBeenCalledTimes(1)
		other.poller.setActive('a', false)
		await vi.advanceTimersByTimeAsync(ACTIVE)
		expect(leader.poll).toHaveBeenCalledTimes(1)
	})

	it('tells peers about a change made by this tab', async () => {
		const b = browser()
		const one = b.tab()
		const two = b.tab()
		one.watch('a')
		two.watch('a', 'b')
		one.poller.notify(['a', 'b'])
		await vi.advanceTimersByTimeAsync(0)
		expect(two.changes).toEqual([['a', 'b']])
		expect(one.changes).toEqual([])
	})

	it('reports refused tokens for renewal', async () => {
		const b = browser()
		const one = b.tab()
		one.watch('a', 'b')
		b.expire(['t:b'])
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(one.expiries).toEqual([['b']])
	})

	it('polls in every tab without Web Locks or BroadcastChannel', async () => {
		const b = browser()
		const one = b.tab({ shared: false })
		const two = b.tab({ shared: false })
		one.watch('a')
		two.watch('a')
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(one.poll).toHaveBeenCalledTimes(1)
		expect(two.poll).toHaveBeenCalledTimes(1)
	})

	it('releases unwatched keys to the next tab', async () => {
		const b = browser()
		const one = b.tab()
		one.watch('a')
		await vi.advanceTimersByTimeAsync(0)
		const two = b.tab()
		two.watch('a')
		one.watch()
		await vi.advanceTimersByTimeAsync(IDLE)
		expect(two.poll).toHaveBeenCalledTimes(1)
		expect(one.poll).not.toHaveBeenCalled()
	})
})
