import { describe, expect, it, vi } from 'vitest'

import { ConversationsRequestError } from './api'
import type { PollerEnv } from './poller'
import { createStreamer, parseEvents } from './sse'
import type { TransportConnection } from './transport'

describe('parseEvents', () => {
	it('splits blocks, skips comments and keeps an unfinished tail', () => {
		const { events, rest } = parseEvents(
			': ping\n\nevent: ready\ndata: {"at":"t"}\n\nevent: changed\ndata: {"keys":["a"]}\n\nevent: cha'
		)
		expect(events).toEqual([
			{ data: '{"at":"t"}', event: 'ready' },
			{ data: '{"keys":["a"]}', event: 'changed' },
		])
		expect(rest).toBe('event: cha')
	})
})

/** A stream the test writes events into and ends. */
const controllable = () => {
	let controller!: ReadableStreamDefaultController<Uint8Array>
	const body = new ReadableStream<Uint8Array>({
		start: (value) => {
			controller = value
		},
	})
	const encoder = new TextEncoder()
	return {
		end: () => controller.close(),
		response: new Response(body),
		send: (event: string, data: unknown) =>
			controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
	}
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const setup = () => {
	const timers = new Map<number, () => void>()
	let nextTimer = 0
	// No Web Locks or BroadcastChannel: the tab holds its own stream.
	const env: PollerEnv = {
		clearTimeout: (timer) => {
			timers.delete(timer as unknown as number)
		},
		isVisible: () => true,
		now: () => Date.parse('2026-01-01T00:00:00.000Z'),
		onVisibilityChange: () => () => undefined,
		setTimeout: (callback) => {
			nextTimer++
			timers.set(nextTimer, callback)
			return nextTimer as unknown as ReturnType<typeof setTimeout>
		},
	}
	const fallback: TransportConnection = {
		destroy: vi.fn(),
		notify: vi.fn(),
		setActive: vi.fn(),
		watch: vi.fn(),
	}
	const streams: Array<ReturnType<typeof controllable>> = []
	const events = vi.fn(async () => {
		const stream = controllable()
		streams.push(stream)
		return stream.response
	})
	const onChange = vi.fn()
	const onExpired = vi.fn()
	const streamer = createStreamer({
		env,
		events,
		fallback,
		instance: 'comments',
		onChange,
		onExpired,
		poll: vi.fn(),
	})
	const runTimers = async () => {
		const due = [...timers.values()]
		timers.clear()
		for (const callback of due) callback()
		await flush()
	}
	return { events, fallback, onChange, onExpired, runTimers, streamer, streams }
}

describe('sse client transport', () => {
	it('streams the watched keys and polls only while the stream is down', async () => {
		const { events, fallback, onChange, runTimers, streamer, streams } = setup()
		streamer.watch([{ key: 'a', token: 't:a' }], '2026-01-01T00:00:00.000Z')
		expect(fallback.watch).toHaveBeenLastCalledWith(
			[{ key: 'a', token: 't:a' }],
			'2026-01-01T00:00:00.000Z'
		)
		await runTimers()
		expect(events).toHaveBeenCalledWith(
			{ since: '2026-01-01T00:00:00.000Z', tokens: ['t:a'] },
			expect.any(AbortSignal)
		)
		streams[0]?.send('ready', { at: '2026-01-01T00:00:01.000Z', expired: [] })
		await flush()
		expect(fallback.watch).toHaveBeenLastCalledWith([], '2026-01-01T00:00:00.000Z')

		streams[0]?.send('changed', { at: '2026-01-01T00:00:05.000Z', keys: ['a', 'other'] })
		await flush()
		expect(onChange).toHaveBeenCalledWith(['a'])

		// A drop: back to polling, then a reconnect that resumes from the last news.
		streams[0]?.end()
		await flush()
		expect(fallback.watch).toHaveBeenLastCalledWith(
			[{ key: 'a', token: 't:a' }],
			'2026-01-01T00:00:00.000Z'
		)
		await runTimers()
		expect(events).toHaveBeenLastCalledWith(
			{ since: '2026-01-01T00:00:05.000Z', tokens: ['t:a'] },
			expect.any(AbortSignal)
		)
	})

	it('maps refused tokens back to keys for renewal', async () => {
		const { onExpired, runTimers, streamer, streams } = setup()
		streamer.watch([{ key: 'a', token: 't:a' }], '2026-01-01T00:00:00.000Z')
		await runTimers()
		streams[0]?.send('ready', { at: '2026-01-01T00:00:01.000Z', expired: ['t:a'] })
		await flush()
		expect(onExpired).toHaveBeenCalledWith(['a'])
	})

	it('stays on polling when the server has no stream', async () => {
		const { events, fallback, runTimers, streamer } = setup()
		events.mockRejectedValueOnce(new ConversationsRequestError('Not Found', 404))
		streamer.watch([{ key: 'a', token: 't:a' }], '2026-01-01T00:00:00.000Z')
		await runTimers()
		await runTimers()
		expect(events).toHaveBeenCalledTimes(1)
		expect(fallback.watch).toHaveBeenLastCalledWith(
			[{ key: 'a', token: 't:a' }],
			'2026-01-01T00:00:00.000Z'
		)
		streamer.destroy()
		expect(fallback.destroy).toHaveBeenCalled()
	})
})
