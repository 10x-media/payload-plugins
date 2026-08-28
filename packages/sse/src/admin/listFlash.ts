export const LIST_FLASH_EVENT = 'sse:list-flash'

export type ListFlashSignal = {
	collection: string
	docId?: string
}

type FlashListener = (signal: ListFlashSignal) => void

const listeners = new Set<FlashListener>()

const toSignal = (flash: ListFlashSignal): ListFlashSignal =>
	flash.docId == null ? { collection: flash.collection } : flash

/** Notify live-list cells that a collection (and optionally one row) mutated over SSE. */
export const emitListFlash = (flash: ListFlashSignal): void => {
	const signal = toSignal(flash)
	for (const listener of listeners) {
		listener(signal)
	}
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(LIST_FLASH_EVENT, { detail: signal }))
	}
}

/** Subscribe to list-flash signals. Returns an unsubscribe. */
export const subscribeListFlash = (listener: FlashListener): (() => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
