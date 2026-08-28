import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestEventSource, MockEventSource, resetMockEventSource } from './mockEventSource'
import { usePayloadList } from './usePayloadList'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	resetMockEventSource()
})

beforeEach(() => {
	resetMockEventSource()
	vi.stubGlobal('EventSource', MockEventSource)
})

describe('usePayloadList', () => {
	it('subscribes to the collection topic', () => {
		renderHook(() => usePayloadList({ collection: 'posts' }))
		expect(latestEventSource().url).toBe(
			`/api/realtime/stream?topics=${encodeURIComponent('posts')}`
		)
	})

	it('increments generation on create, update, and delete', async () => {
		const { result } = renderHook(() => usePayloadList({ collection: 'posts' }))

		expect(result.current.generation).toBe(0)

		act(() => {
			latestEventSource().emitOpen()
		})

		for (const event of ['create', 'update', 'delete'] as const) {
			act(() => {
				latestEventSource().emit(
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
		const { result } = renderHook(() => usePayloadList({ collection: 'posts' }))

		act(() => {
			latestEventSource().emitOpen()
			latestEventSource().emit(
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
