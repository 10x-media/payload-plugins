export interface WriteBufferOptions<T> {
	maxSize: number
	maxAgeMs: number
	onFlush: (items: T[]) => Promise<void>
	onError?: (error: unknown) => void
	/** Schedules a one-shot timer and returns a cancel function. Injectable for tests. */
	setTimer?: (fn: () => void, ms: number) => () => void
}

export interface WriteBuffer<T> {
	add: (item: T) => void
	flush: () => Promise<void>
	stop: () => Promise<void>
	size: () => number
}

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
	const handle = setTimeout(fn, ms)
	// unref so a pending flush timer never keeps the process (or a test runner) alive.
	const unrefable = handle as { unref?: () => void }
	unrefable.unref?.()
	return () => clearTimeout(handle)
}

// In-process accumulator that flushes on a size threshold or an age timer, whichever comes
// first. Flushes are serialized through a promise chain so callers can await a full drain.
export function createWriteBuffer<T>(options: WriteBufferOptions<T>): WriteBuffer<T> {
	const { maxSize, maxAgeMs, onFlush, onError } = options
	const setTimer = options.setTimer ?? defaultSetTimer
	let items: T[] = []
	let cancelTimer: (() => void) | null = null
	let chain: Promise<void> = Promise.resolve()

	const disarm = (): void => {
		if (cancelTimer) {
			cancelTimer()
			cancelTimer = null
		}
	}

	const drain = async (): Promise<void> => {
		disarm()
		if (items.length === 0) {
			return
		}
		const batch = items
		items = []
		try {
			await onFlush(batch)
		} catch (error) {
			onError?.(error)
		}
		if (items.length > 0) {
			await drain()
		}
	}

	const flush = (): Promise<void> => {
		chain = chain.then(drain)
		return chain
	}

	const add = (item: T): void => {
		items.push(item)
		if (items.length >= maxSize) {
			void flush()
			return
		}
		if (!cancelTimer) {
			cancelTimer = setTimer(() => {
				void flush()
			}, maxAgeMs)
		}
	}

	return { add, flush, stop: flush, size: () => items.length }
}
