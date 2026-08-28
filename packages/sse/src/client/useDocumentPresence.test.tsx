import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { latestEventSource, MockEventSource, resetMockEventSource } from './mockEventSource'
import { useDocumentPresence } from './useDocumentPresence'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	resetMockEventSource()
})

beforeEach(() => {
	resetMockEventSource()
	vi.stubGlobal('EventSource', MockEventSource)
})

describe('useDocumentPresence', () => {
	it('POSTs join, returns peers and self, and DELETEs on unmount', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			if (method === 'POST') {
				return new Response(
					JSON.stringify({
						peers: [
							{ id: 'u1', label: 'u1' },
							{ id: 'u2', label: 'Bob' },
						],
						self: { id: 'u1', label: 'u1' },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				)
			}
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			throw new Error(`unexpected ${method} ${String(input)}`)
		})
		vi.stubGlobal('fetch', fetchMock)

		const { result, unmount } = renderHook(() => useDocumentPresence('posts', '1'))

		await waitFor(() => {
			expect(result.current.self).toEqual({ id: 'u1', label: 'u1' })
			expect(result.current.peers).toEqual([
				{ id: 'u1', label: 'u1' },
				{ id: 'u2', label: 'Bob' },
			])
		})

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/realtime/presence',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				body: JSON.stringify({ collection: 'posts', id: '1' }),
			})
		)

		expect(latestEventSource().url).toContain(encodeURIComponent('presence:posts:1'))

		unmount()

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/realtime/presence',
				expect.objectContaining({
					method: 'DELETE',
					body: JSON.stringify({ collection: 'posts', id: '1' }),
				})
			)
		})
	})

	it('heartbeats on the configured interval', async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			if (method === 'POST') {
				return new Response(
					JSON.stringify({ peers: [{ id: 'u1', label: 'u1' }], self: { id: 'u1', label: 'u1' } }),
					{ status: 200 }
				)
			}
			return new Response(JSON.stringify({ peers: [] }), { status: 200 })
		})
		vi.stubGlobal('fetch', fetchMock)

		renderHook(() => useDocumentPresence('posts', '1', { heartbeatMs: 5_000 }))

		await act(async () => {
			await Promise.resolve()
		})
		expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1)

		await act(async () => {
			vi.advanceTimersByTime(5_000)
			await Promise.resolve()
		})
		expect(
			fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST').length
		).toBeGreaterThanOrEqual(2)
	})

	it('updates peers from presence:join event data', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'POST') {
				return new Response(
					JSON.stringify({ peers: [{ id: 'u1', label: 'u1' }], self: { id: 'u1', label: 'u1' } }),
					{ status: 200 }
				)
			}
			return new Response(JSON.stringify({ peers: [] }), { status: 200 })
		})
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => useDocumentPresence('posts', '1'))

		await waitFor(() => {
			expect(result.current.self).toEqual({ id: 'u1', label: 'u1' })
		})

		act(() => {
			latestEventSource().emitOpen()
			latestEventSource().emit(
				'presence:join',
				JSON.stringify({
					id: 'e1',
					topic: 'presence:posts:1',
					event: 'presence:join',
					timestamp: 1,
					data: {
						peers: [
							{ id: 'u1', label: 'u1' },
							{ id: 'u2', label: 'Bob' },
						],
					},
				})
			)
		})

		await waitFor(() => {
			expect(result.current.peers).toEqual([
				{ id: 'u1', label: 'u1' },
				{ id: 'u2', label: 'Bob' },
			])
		})
	})
})
