import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveListSync } from './LiveListSync'
import { subscribeListFlash } from './listFlash'

const listState = vi.hoisted(() => ({
	generation: 0,
	docId: 'abc' as string | undefined,
}))

vi.mock('@payloadcms/ui', () => ({
	useListQuery: () => ({
		refineListData: vi.fn(),
		query: { page: 1 },
	}),
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../client/usePayloadList', () => ({
	usePayloadList: () => ({
		generation: listState.generation,
		lastEvent:
			listState.docId != null ? { docId: listState.docId, event: 'update' } : { event: 'delete' },
		status: 'open',
	}),
}))

beforeEach(() => {
	listState.generation = 0
	listState.docId = 'abc'
})

afterEach(() => {
	cleanup()
})

describe('LiveListSync', () => {
	it('emits a list-flash with the mutated docId when generation bumps', async () => {
		const listener = vi.fn()
		const unsubscribe = subscribeListFlash(listener)

		const { rerender } = render(<LiveListSync collection="posts" />)

		listState.generation = 1
		listState.docId = 'abc'
		rerender(<LiveListSync collection="posts" />)

		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ collection: 'posts', docId: 'abc' })
		})
		unsubscribe()
	})

	it('emits a collection-only flash when the event has no docId', async () => {
		const listener = vi.fn()
		const unsubscribe = subscribeListFlash(listener)

		const { rerender } = render(<LiveListSync collection="posts" />)

		listState.generation = 1
		listState.docId = undefined
		rerender(<LiveListSync collection="posts" />)

		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith({ collection: 'posts' })
		})
		unsubscribe()
	})
})
