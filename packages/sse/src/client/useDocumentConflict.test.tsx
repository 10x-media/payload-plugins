import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createControllableSseFetch } from './controllableSseFetch'
import { useDocumentConflict } from './useDocumentConflict'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const emitWrite = (
	sse: ReturnType<typeof createControllableSseFetch>,
	event: {
		id: string
		operation: 'update' | 'delete' | 'create' | 'ready'
		actorId?: string
	}
) => {
	sse.emit(
		event.operation,
		JSON.stringify({
			id: event.id,
			topic: 'posts:1',
			event: event.operation,
			collection: 'posts',
			docId: '1',
			operation: event.operation === 'ready' ? undefined : event.operation,
			timestamp: 1,
			...(event.actorId ? { actorId: event.actorId } : {}),
		})
	)
}

describe('useDocumentConflict', () => {
	it('subscribes to the document topic', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: false })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalledWith(
				expect.stringContaining(encodeURIComponent('posts:1')),
				expect.anything()
			)
		})
	})

	it('shows a foreign update while modified', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: true })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})

		await waitFor(() => {
			expect(result.current.conflict).toEqual({
				id: 'e1',
				operation: 'update',
				actorId: 'other',
			})
		})
	})

	it('ignores own actorId', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: true })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'self' })
		})

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})
		expect(result.current.conflict).toBeNull()
	})

	it('clears a foreign conflict when an own write arrives', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: true })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})
		await waitFor(() => {
			expect(result.current.conflict?.id).toBe('e1')
		})

		act(() => {
			emitWrite(sse, { id: 'e2', operation: 'update', actorId: 'self' })
		})
		await waitFor(() => {
			expect(result.current.conflict).toBeNull()
		})
	})

	it('remembers a foreign write while clean and surfaces it when modified', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result, rerender } = renderHook(
			({ modified }: { modified: boolean }) =>
				useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified }),
			{ initialProps: { modified: false } }
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})
		await waitFor(() => {
			expect(result.current.conflict).toBeNull()
		})

		rerender({ modified: true })
		expect(result.current.conflict).toEqual({
			id: 'e1',
			operation: 'update',
			actorId: 'other',
		})
	})

	it('does not re-show a dismissed event until a newer foreign write', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: true })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})
		await waitFor(() => {
			expect(result.current.conflict?.id).toBe('e1')
		})

		act(() => {
			result.current.dismiss()
		})
		expect(result.current.conflict).toBeNull()

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})
		expect(result.current.conflict).toBeNull()

		act(() => {
			emitWrite(sse, { id: 'e2', operation: 'update', actorId: 'other' })
		})
		await waitFor(() => {
			expect(result.current.conflict).toEqual({
				id: 'e2',
				operation: 'update',
				actorId: 'other',
			})
		})
	})

	it('treats delete as a distinct operation and missing actorId as foreign', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result } = renderHook(() =>
			useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified: true })
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'ready', operation: 'ready' })
			emitWrite(sse, { id: 'c1', operation: 'create', actorId: 'other' })
		})
		expect(result.current.conflict).toBeNull()

		act(() => {
			emitWrite(sse, { id: 'd1', operation: 'delete' })
		})
		await waitFor(() => {
			expect(result.current.conflict).toEqual({
				id: 'd1',
				operation: 'delete',
				actorId: undefined,
			})
		})
	})

	it('keeps the remembered foreign write when modified goes false then true', async () => {
		const sse = createControllableSseFetch()
		vi.stubGlobal('fetch', sse.fetchMock)

		const { result, rerender } = renderHook(
			({ modified }: { modified: boolean }) =>
				useDocumentConflict({ collection: 'posts', id: '1', selfId: 'self', modified }),
			{ initialProps: { modified: true } }
		)

		await waitFor(() => {
			expect(sse.fetchMock).toHaveBeenCalled()
		})

		act(() => {
			emitWrite(sse, { id: 'e1', operation: 'update', actorId: 'other' })
		})
		await waitFor(() => {
			expect(result.current.conflict?.id).toBe('e1')
		})

		rerender({ modified: false })
		expect(result.current.conflict).toBeNull()
		rerender({ modified: true })
		expect(result.current.conflict?.id).toBe('e1')
	})
})
