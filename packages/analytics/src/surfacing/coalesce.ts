/** Runs one worker per key at a time: a call made while it runs joins its promise. */
export interface Coalescer<T> {
	(key: string, worker: () => Promise<T>): Promise<T>
	/** Whether a worker for `key` is still running, which a new call would join. */
	has(key: string): boolean
}

export function createCoalescer<T>(): Coalescer<T> {
	const inFlight = new Map<string, Promise<T>>()
	const coalesce = (key: string, worker: () => Promise<T>): Promise<T> => {
		const existing = inFlight.get(key)
		if (existing) return existing
		const promise = worker().finally(() => inFlight.delete(key))
		inFlight.set(key, promise)
		return promise
	}
	return Object.assign(coalesce, { has: (key: string) => inFlight.has(key) })
}
