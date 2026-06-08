export type Coalescer<T> = (key: string, worker: () => Promise<T>) => Promise<T>

export function createCoalescer<T>(): Coalescer<T> {
	const inFlight = new Map<string, Promise<T>>()
	return (key, worker) => {
		const existing = inFlight.get(key)
		if (existing) return existing
		const promise = worker().finally(() => inFlight.delete(key))
		inFlight.set(key, promise)
		return promise
	}
}
