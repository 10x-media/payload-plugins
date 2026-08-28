import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createControllableSseFetch } from './controllableSseFetch'
import { usePayloadDocument } from './usePayloadDocument'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('usePayloadDocument', () => {
	it('subscribes to collection:id and merges data.doc', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() => usePayloadDocument({ collection: 'posts', id: '1' }))

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalledWith(
				expect.stringContaining(encodeURIComponent('posts:1')),
				expect.anything()
			)
		})

		const enriched = {
			id: 'e1',
			topic: 'posts:1',
			event: 'update',
			collection: 'posts',
			docId: '1',
			timestamp: 1,
			data: { doc: { id: '1', title: 'Hello' } },
		}

		act(() => {
			sse.emit('update', JSON.stringify(enriched))
		})

		await waitFor(() => {
			expect(result.current.doc).toEqual({ id: '1', title: 'Hello' })
			expect(result.current.revision).toBe(0)
			expect(result.current.lastEvent).toEqual(enriched)
		})
	})

	it('increments revision when event has no data.doc', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() => usePayloadDocument({ collection: 'posts', id: '1' }))

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			sse.emit(
				'update',
				JSON.stringify({
					id: 'e1',
					topic: 'posts:1',
					event: 'update',
					timestamp: 1,
				})
			)
		})

		await waitFor(() => {
			expect(result.current.revision).toBe(1)
			expect(result.current.doc).toBeNull()
		})
	})

	it('resets doc and revision when collection or id changes', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result, rerender } = renderHook(
			({ collection, id }) => usePayloadDocument({ collection, id }),
			{ initialProps: { collection: 'posts', id: '1' } }
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			sse.emit(
				'update',
				JSON.stringify({
					id: 'e1',
					topic: 'posts:1',
					event: 'update',
					timestamp: 1,
					data: { doc: { id: '1', title: 'A' } },
				})
			)
		})

		await waitFor(() => {
			expect(result.current.doc).toEqual({ id: '1', title: 'A' })
		})

		act(() => {
			sse.emit(
				'update',
				JSON.stringify({
					id: 'e2',
					topic: 'posts:1',
					event: 'update',
					timestamp: 2,
				})
			)
		})

		await waitFor(() => {
			expect(result.current.revision).toBe(1)
		})

		rerender({ collection: 'posts', id: '2' })

		await waitFor(() => {
			expect(result.current.doc).toBeNull()
			expect(result.current.revision).toBe(0)
		})
	})
})
