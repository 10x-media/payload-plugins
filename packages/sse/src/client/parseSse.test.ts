import { describe, expect, it, vi } from 'vitest'
import { buildStreamUrl, createSseParser } from './parseSse'

describe('buildStreamUrl', () => {
	it('appends encoded topics as a comma-separated query', () => {
		expect(buildStreamUrl('/api/realtime/stream', ['posts', 'posts:1'])).toBe(
			`/api/realtime/stream?topics=${encodeURIComponent('posts')},${encodeURIComponent('posts:1')}`
		)
	})

	it('preserves an existing query string', () => {
		expect(buildStreamUrl('/api/realtime/stream?foo=1', ['posts'])).toBe(
			`/api/realtime/stream?foo=1&topics=${encodeURIComponent('posts')}`
		)
	})
})

describe('createSseParser', () => {
	it('emits a complete named event frame', () => {
		const onFrame = vi.fn()
		const parser = createSseParser(onFrame)

		parser.push('event: ready\ndata: {"id":"1","topic":"posts","event":"ready","timestamp":1}\n\n')

		expect(onFrame).toHaveBeenCalledTimes(1)
		expect(onFrame).toHaveBeenCalledWith({
			event: 'ready',
			data: '{"id":"1","topic":"posts","event":"ready","timestamp":1}',
			id: undefined,
			retry: undefined,
		})
	})

	it('buffers across chunk boundaries', () => {
		const onFrame = vi.fn()
		const parser = createSseParser(onFrame)

		parser.push('event: update\ndata: {"id"')
		expect(onFrame).not.toHaveBeenCalled()
		parser.push(':"2"}\nid: evt-2\n\n')

		expect(onFrame).toHaveBeenCalledWith({
			event: 'update',
			data: '{"id":"2"}',
			id: 'evt-2',
			retry: undefined,
		})
	})

	it('parses retry and multi-line data', () => {
		const onFrame = vi.fn()
		const parser = createSseParser(onFrame)

		parser.push('retry: 5000\ndata: {"a":1}\ndata: {"b":2}\n\n')

		expect(onFrame).toHaveBeenCalledWith({
			event: undefined,
			data: '{"a":1}\n{"b":2}',
			id: undefined,
			retry: 5000,
		})
	})

	it('ignores comment lines', () => {
		const onFrame = vi.fn()
		const parser = createSseParser(onFrame)

		parser.push(': keepalive\n\nevent: ready\ndata: {}\n\n')

		expect(onFrame).toHaveBeenCalledTimes(1)
		expect(onFrame.mock.calls[0]?.[0]).toMatchObject({ event: 'ready', data: '{}' })
	})
})
