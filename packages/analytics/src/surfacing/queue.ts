export interface QueueOptions {
	concurrency: number
	maxRetries?: number
	baseDelayMs?: number
}

export interface Queue {
	run<T>(task: () => Promise<T>): Promise<T>
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createQueue(opts: QueueOptions): Queue {
	const maxRetries = opts.maxRetries ?? 0
	const baseDelayMs = opts.baseDelayMs ?? 200
	let active = 0
	const pending: Array<() => void> = []

	const acquire = (): Promise<void> => {
		if (active < opts.concurrency) {
			active++
			return Promise.resolve()
		}
		return new Promise<void>((resolve) => pending.push(resolve)).then(() => {
			active++
		})
	}

	const release = (): void => {
		active--
		pending.shift()?.()
	}

	const withRetry = async <T>(task: () => Promise<T>): Promise<T> => {
		let attempt = 0
		for (;;) {
			try {
				return await task()
			} catch (err) {
				if (attempt >= maxRetries) throw err
				// Jitter derived from attempt count, not Math.random, to keep tests deterministic
				const jitter = baseDelayMs * 0.5
				await wait(baseDelayMs * 2 ** attempt + jitter * attempt)
				attempt++
			}
		}
	}

	return {
		async run<T>(task: () => Promise<T>): Promise<T> {
			await acquire()
			try {
				return await withRetry(task)
			} finally {
				release()
			}
		},
	}
}
