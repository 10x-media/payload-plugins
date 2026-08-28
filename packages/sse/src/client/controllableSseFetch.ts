import { type Mock, vi } from 'vitest'

/** Controllable fetch + SSE body for hook tests that previously used EventSource. */
export type ControllableSse = {
	fetchMock: Mock
	emit: (event: string, data: string) => void
	close: () => void
}

export const createControllableSseFetch = (): ControllableSse => {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined
	const encoder = new TextEncoder()

	const fetchMock = vi.fn().mockImplementation(() => {
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				controller = c
			},
		})
		return Promise.resolve(
			new Response(body, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		)
	})

	return {
		fetchMock,
		emit: (event, data) => {
			controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
		},
		close: () => {
			try {
				controller?.close()
			} catch {
				// already closed
			}
		},
	}
}
