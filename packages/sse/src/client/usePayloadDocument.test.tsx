import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestEventSource, MockEventSource, resetMockEventSource } from './mockEventSource'
import { usePayloadDocument } from './usePayloadDocument'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	resetMockEventSource()
})

beforeEach(() => {
	resetMockEventSource()
	vi.stubGlobal('EventSource', MockEventSource)
})

describe('usePayloadDocument', () => {
	it('subscribes to collection:id and merges data.doc', async () => {
		const { result } = renderHook(() => usePayloadDocument({ collection: 'posts', id: '1' }))

		expect(latestEventSource().url).toContain(encodeURIComponent('posts:1'))

		act(() => {
			latestEventSource().emitOpen()
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
			latestEventSource().emit('update', JSON.stringify(enriched))
		})

		await waitFor(() => {
			expect(result.current.doc).toEqual({ id: '1', title: 'Hello' })
			expect(result.current.revision).toBe(0)
			expect(result.current.lastEvent).toEqual(enriched)
		})
	})

	it('increments revision when event has no data.doc', async () => {
		const { result } = renderHook(() => usePayloadDocument({ collection: 'posts', id: '1' }))

		act(() => {
			latestEventSource().emitOpen()
			latestEventSource().emit(
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
})
