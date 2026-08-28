export const LIST_FLASH_EVENT = 'sse:list-flash'

type FlashListener = (collection: string) => void

const listeners = new Set<FlashListener>()

/** Notify live-list cells that `collection` just mutated over SSE. */
export const emitListFlash = (collection: string): void => {
	for (const listener of listeners) {
		listener(collection)
	}
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(LIST_FLASH_EVENT, { detail: { collection } }))
	}
}

/** Subscribe to list-flash signals. Returns an unsubscribe. */
export const subscribeListFlash = (listener: FlashListener): (() => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
