import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePayloadSubscription } from './usePayloadSubscription'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('usePayloadSubscription (cookie / fetch)', () => {
	it('opens fetch with credentials and topics query, without Authorization', async () => {
		const hang = new ReadableStream<Uint8Array>({ start() {} })
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(hang, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		)
		vi.stubGlobal('fetch', fetchMock)

		const { result, unmount } = renderHook(() =>
			usePayloadSubscription({ topics: ['posts', 'posts:1'] })
		)

		expect(result.current.status).toBe('connecting')
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled()
		})
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/realtime/stream?topics=${encodeURIComponent('posts')},${encodeURIComponent('posts:1')}`,
			expect.objectContaining({
				credentials: 'include',
				headers: expect.objectContaining({
					Accept: 'text/event-stream',
				}),
			})
		)
		const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit)?.headers as Record<string, string>
		expect(headers.Authorization).toBeUndefined()
		unmount()
	})

	it('moves to open on ready and records events', async () => {
		const encoder = new TextEncoder()
		const ready = {
			id: 'r1',
			topic: 'posts',
			event: 'ready',
			timestamp: 1,
		}
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify(ready)}\n\n`))
			},
		})
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(body, {
					status: 200,
					headers: { 'Content-Type': 'text/event-stream' },
				})
			)
		)

		const onEvent = vi.fn()
		const { result } = renderHook(() => usePayloadSubscription({ topics: ['posts'], onEvent }))

		await waitFor(() => {
			expect(result.current.status).toBe('open')
		})
		expect(onEvent).toHaveBeenCalledWith(ready)
		expect(result.current.lastEvent).toEqual(ready)
	})

	it('closes on 403 and does not reconnect', async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => usePayloadSubscription({ topics: ['posts'] }))

		await act(async () => {
			await Promise.resolve()
		})

		expect(result.current.status).toBe('closed')
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000)
		})

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})

describe('usePayloadSubscription (bearer / fetch)', () => {
	it('sends Authorization Bearer and parses the stream', async () => {
		const encoder = new TextEncoder()
		const ready = {
			id: 'r1',
			topic: 'posts',
			event: 'ready',
			timestamp: 1,
		}
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(`retry: 1500\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`)
				)
				controller.enqueue(
					encoder.encode(
						`event: update\ndata: ${JSON.stringify({
							id: 'u1',
							topic: 'posts',
							event: 'update',
							timestamp: 2,
						})}\n\n`
					)
				)
			},
		})

		const fetchMock = vi.fn().mockResolvedValue(
			new Response(body, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		)
		vi.stubGlobal('fetch', fetchMock)

		const onEvent = vi.fn()
		const { result } = renderHook(() =>
			usePayloadSubscription({ topics: ['posts'], token: 'secret', onEvent })
		)

		expect(result.current.status).toBe('connecting')

		await waitFor(() => {
			expect(result.current.status).toBe('open')
		})

		expect(fetchMock).toHaveBeenCalledWith(
			`/api/realtime/stream?topics=${encodeURIComponent('posts')}`,
			expect.objectContaining({
				credentials: 'include',
				headers: expect.objectContaining({
					Authorization: 'Bearer secret',
					Accept: 'text/event-stream',
				}),
			})
		)
		expect(onEvent).toHaveBeenCalledWith(ready)

		await waitFor(() => {
			expect(result.current.lastEvent?.event).toBe('update')
		})
	})

	it('reconnects after stream end using parsed retry delay', async () => {
		const encoder = new TextEncoder()
		const ready = {
			id: 'r1',
			topic: 'posts',
			event: 'ready',
			timestamp: 1,
		}

		let call = 0
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(() => {
				call += 1
				if (call === 1) {
					const body = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								encoder.encode(`retry: 50\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`)
							)
							controller.close()
						},
					})
					return Promise.resolve(
						new Response(body, {
							status: 200,
							headers: { 'Content-Type': 'text/event-stream' },
						})
					)
				}
				const hang = new ReadableStream<Uint8Array>({ start() {} })
				return Promise.resolve(
					new Response(hang, {
						status: 200,
						headers: { 'Content-Type': 'text/event-stream' },
					})
				)
			})
		)

		const onEvent = vi.fn()
		const { unmount } = renderHook(() =>
			usePayloadSubscription({ topics: ['posts'], token: 't', onEvent })
		)

		await waitFor(() => {
			expect(onEvent).toHaveBeenCalledWith(ready)
		})

		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
		})

		unmount()
	})

	it('closes on 401 and does not reconnect', async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => usePayloadSubscription({ topics: ['posts'], token: 'bad' }))

		await act(async () => {
			await Promise.resolve()
		})

		expect(result.current.status).toBe('closed')
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000)
		})

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('aborts fetch on unmount', async () => {
		let aborted = false
		const body = new ReadableStream<Uint8Array>({
			start() {
				/* hang open */
			},
		})
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
				init?.signal?.addEventListener('abort', () => {
					aborted = true
				})
				return Promise.resolve(
					new Response(body, {
						status: 200,
						headers: { 'Content-Type': 'text/event-stream' },
					})
				)
			})
		)

		const { unmount } = renderHook(() => usePayloadSubscription({ topics: ['posts'], token: 't' }))

		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalled()
		})

		unmount()
		expect(aborted).toBe(true)
	})
})
