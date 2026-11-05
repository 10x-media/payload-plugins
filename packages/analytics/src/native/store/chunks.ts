/** Refuses a chunk size that could never end a loop: anything but a whole number above zero. */
export const checkLimit = (limit: number): number => {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError(`analytics: a chunk needs a whole size of at least 1, got ${limit}`)
	}
	return limit
}

/** `items` in runs of at most `size`, in order: how many keys or rows one statement carries. */
export const chunksOf = <T>(items: readonly T[], size: number): T[][] => {
	checkLimit(size)
	const chunks: T[][] = []
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size))
	}
	return chunks
}

/** Lets the event loop run whatever waits on it before the next slice of a long job. */
export const yieldToLoop = (): Promise<void> =>
	new Promise((resolve) => {
		setImmediate(resolve)
	})

/**
 * `items` mapped by `work`, `size` at a time with the event loop let in between, so a long job on
 * this thread never holds it for longer than one slice.
 */
export const mapInSlices = async <T, R>(
	items: readonly T[],
	size: number,
	work: (item: T) => R
): Promise<R[]> => {
	checkLimit(size)
	const mapped: R[] = []
	for (let start = 0; start < items.length; start += size) {
		if (start > 0) {
			await yieldToLoop()
		}
		for (const item of items.slice(start, start + size)) {
			mapped.push(work(item))
		}
	}
	return mapped
}
