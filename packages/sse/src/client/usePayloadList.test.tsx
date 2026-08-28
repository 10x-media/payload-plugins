import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createControllableSseFetch } from './controllableSseFetch'
import { usePayloadList } from './usePayloadList'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('usePayloadList', () => {
	it('subscribes to the collection topic', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { unmount } = renderHook(() => usePayloadList({ collection: 'posts' }))

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalledWith(
				`/api/realtime/stream?topics=${encodeURIComponent('posts')}`,
				expect.objectContaining({ credentials: 'include' })
			)
		})
		unmount()
	})

	it('increments generation on create, update, and delete', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() => usePayloadList({ collection: 'posts' }))

		expect(result.current.generation).toBe(0)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		for (const event of ['create', 'update', 'delete'] as const) {
			act(() => {
				sse.emit(
					event,
					JSON.stringify({
						id: event,
						topic: 'posts',
						event,
						timestamp: 1,
					})
				)
			})
		}

		await waitFor(() => {
			expect(result.current.generation).toBe(3)
		})
	})

	it('does not increment generation on ready', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() => usePayloadList({ collection: 'posts' }))

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			sse.emit(
				'ready',
				JSON.stringify({
					id: 'r',
					topic: 'posts',
					event: 'ready',
					timestamp: 1,
				})
			)
		})

		await waitFor(() => {
			expect(result.current.lastEvent?.event).toBe('ready')
		})
		expect(result.current.generation).toBe(0)
	})
})
