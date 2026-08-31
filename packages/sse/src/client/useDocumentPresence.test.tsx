import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createControllableSseFetch } from './controllableSseFetch'
import { useDocumentPresence } from './useDocumentPresence'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

const hangStream = () =>
	new Response(new ReadableStream<Uint8Array>({ start() {} }), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' },
	})

describe('useDocumentPresence', () => {
	it('POSTs join, returns peers and self, and DELETEs on unmount', async () => {
		const sse = createControllableSseFetch()
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
			return sse.fetchMock(input, init)
		})
		vi.stubGlobal('fetch', fetchMock)

		const { result, unmount } = renderHook(() => useDocumentPresence('posts', '1'))

		await waitFor(() => {
			expect(result.current.self).toEqual({ id: 'u1', label: 'u1', mode: 'viewing' })
			expect(result.current.peers).toEqual([
				{ id: 'u1', label: 'u1', mode: 'viewing' },
				{ id: 'u2', label: 'Bob', mode: 'viewing' },
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

		await waitFor(() => {
			expect(
				fetchMock.mock.calls.some(
					(c) => typeof c[0] === 'string' && c[0].includes(encodeURIComponent('presence:posts:1'))
				)
			).toBe(true)
		})

		unmount()

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/realtime/presence',
				expect.objectContaining({
					method: 'DELETE',
					keepalive: true,
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
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return hangStream()
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
		const sse = createControllableSseFetch()
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'POST') {
				return new Response(
					JSON.stringify({ peers: [{ id: 'u1', label: 'u1' }], self: { id: 'u1', label: 'u1' } }),
					{ status: 200 }
				)
			}
			if ((init?.method ?? 'GET') === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return sse.fetchMock(input, init)
		})
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => useDocumentPresence('posts', '1'))

		await waitFor(() => {
			expect(result.current.self).toEqual({ id: 'u1', label: 'u1', mode: 'viewing' })
		})

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			sse.emit(
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
				{ id: 'u1', label: 'u1', mode: 'viewing' },
				{ id: 'u2', label: 'Bob', mode: 'viewing' },
			])
		})
	})

	it('aborts in-flight POST on unmount and DELETEs without applying late join', async () => {
		const methods: string[] = []
		let postSignal: AbortSignal | undefined
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			methods.push(method)
			if (method === 'POST') {
				postSignal = init?.signal ?? undefined
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('Aborted', 'AbortError'))
					})
				})
			}
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return hangStream()
		})
		vi.stubGlobal('fetch', fetchMock)

		const { result, unmount } = renderHook(() => useDocumentPresence('posts', '1'))

		await waitFor(() => {
			expect(methods).toContain('POST')
		})

		unmount()

		await waitFor(() => {
			expect(methods.at(-1)).toBe('DELETE')
		})

		expect(postSignal?.aborted).toBe(true)
		expect(result.current.self).toBeNull()
		expect(result.current.peers).toEqual([])
		expect(methods.filter((m) => m === 'POST')).toHaveLength(1)
		expect(methods.filter((m) => m === 'DELETE')).toHaveLength(1)
	})

	it('does not DELETE when mode flips from viewing to editing', async () => {
		const methods: string[] = []
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			methods.push(method)
			if (method === 'POST') {
				return new Response(
					JSON.stringify({
						peers: [{ id: 'u1', label: 'u1', mode: 'viewing' }],
						self: { id: 'u1', label: 'u1', mode: 'viewing' },
					}),
					{ status: 200 }
				)
			}
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return hangStream()
		})
		vi.stubGlobal('fetch', fetchMock)

		const { rerender, unmount } = renderHook(
			({ mode }: { mode: 'viewing' | 'editing' }) => useDocumentPresence('posts', '1', { mode }),
			{ initialProps: { mode: 'viewing' as 'viewing' | 'editing' } }
		)

		await waitFor(() => {
			expect(methods.filter((m) => m === 'POST')).toHaveLength(1)
		})

		rerender({ mode: 'editing' })

		await waitFor(() => {
			expect(
				fetchMock.mock.calls.some(
					(c) =>
						c[1]?.method === 'POST' &&
						c[1]?.body === JSON.stringify({ collection: 'posts', id: '1', mode: 'editing' })
				)
			).toBe(true)
		})

		expect(methods.filter((m) => m === 'DELETE')).toHaveLength(0)
		unmount()
		await waitFor(() => {
			expect(methods.filter((m) => m === 'DELETE')).toHaveLength(1)
		})
	})

	it('aborts in-flight mode POST on unmount so a late join cannot resurrect the lease', async () => {
		const methods: string[] = []
		let modeSignal: AbortSignal | undefined
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			methods.push(method)
			if (method === 'POST') {
				const postCount = methods.filter((m) => m === 'POST').length
				if (postCount === 1) {
					return new Response(
						JSON.stringify({
							peers: [{ id: 'u1', label: 'u1', mode: 'viewing' }],
							self: { id: 'u1', label: 'u1', mode: 'viewing' },
						}),
						{ status: 200 }
					)
				}
				modeSignal = init?.signal ?? undefined
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('Aborted', 'AbortError'))
					})
				})
			}
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return hangStream()
		})
		vi.stubGlobal('fetch', fetchMock)

		const { rerender, unmount } = renderHook(
			({ mode }: { mode: 'viewing' | 'editing' }) => useDocumentPresence('posts', '1', { mode }),
			{ initialProps: { mode: 'viewing' as 'viewing' | 'editing' } }
		)

		await waitFor(() => {
			expect(methods.filter((m) => m === 'POST')).toHaveLength(1)
		})

		rerender({ mode: 'editing' })

		await waitFor(() => {
			expect(methods.filter((m) => m === 'POST')).toHaveLength(2)
		})

		unmount()

		await waitFor(() => {
			expect(methods.filter((m) => m === 'DELETE')).toHaveLength(1)
		})
		expect(modeSignal?.aborted).toBe(true)
	})

	it('POSTs mode when provided', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			if (method === 'POST') {
				return new Response(
					JSON.stringify({
						peers: [{ id: 'u1', label: 'u1', mode: 'editing' }],
						self: { id: 'u1', label: 'u1', mode: 'editing' },
					}),
					{ status: 200 }
				)
			}
			if (method === 'DELETE') {
				return new Response(JSON.stringify({ peers: [] }), { status: 200 })
			}
			return hangStream()
		})
		vi.stubGlobal('fetch', fetchMock)

		renderHook(() => useDocumentPresence('posts', '1', { mode: 'editing' }))

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/realtime/presence',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ collection: 'posts', id: '1', mode: 'editing' }),
				})
			)
		})
	})
})
