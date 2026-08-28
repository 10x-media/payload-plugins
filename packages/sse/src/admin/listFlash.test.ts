import { afterEach, describe, expect, it, vi } from 'vitest'

import { emitListFlash, LIST_FLASH_EVENT, subscribeListFlash } from './listFlash'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('listFlash', () => {
	it('notifies subscribers with collection and docId', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeListFlash(listener)

		emitListFlash({ collection: 'posts', docId: 'abc' })

		expect(listener).toHaveBeenCalledOnce()
		expect(listener).toHaveBeenCalledWith({ collection: 'posts', docId: 'abc' })
		unsubscribe()
	})

	it('allows a collection-only signal when docId is omitted', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeListFlash(listener)

		emitListFlash({ collection: 'posts' })

		expect(listener).toHaveBeenCalledWith({ collection: 'posts' })
		unsubscribe()
	})

	it('dispatches a window event with the same detail', () => {
		const dispatchEvent = vi.fn()
		vi.stubGlobal('window', { dispatchEvent })

		emitListFlash({ collection: 'posts', docId: 'abc' })

		expect(dispatchEvent).toHaveBeenCalledOnce()
		const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent
		expect(event.type).toBe(LIST_FLASH_EVENT)
		expect(event.detail).toEqual({ collection: 'posts', docId: 'abc' })
	})
})
