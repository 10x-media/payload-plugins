type Listener = (ev: MessageEvent) => void

/** Test double for cookie-path EventSource. */
export class MockEventSource {
	static instances: MockEventSource[] = []
	url: string
	withCredentials: boolean
	readyState = 0
	onopen: ((ev: Event) => void) | null = null
	onerror: ((ev: Event) => void) | null = null
	onmessage: ((ev: MessageEvent) => void) | null = null
	#listeners = new Map<string, Set<Listener>>()
	closed = false

	constructor(url: string, init?: { withCredentials?: boolean }) {
		this.url = url
		this.withCredentials = init?.withCredentials ?? false
		MockEventSource.instances.push(this)
	}

	addEventListener(type: string, listener: Listener) {
		let set = this.#listeners.get(type)
		if (!set) {
			set = new Set()
			this.#listeners.set(type, set)
		}
		set.add(listener)
	}

	removeEventListener(type: string, listener: Listener) {
		this.#listeners.get(type)?.delete(listener)
	}

	close() {
		this.closed = true
		this.readyState = 2
	}

	emitOpen() {
		this.readyState = 1
		this.onopen?.(new Event('open'))
	}

	emitError() {
		this.onerror?.(new Event('error'))
	}

	emit(type: string, data: string) {
		const ev = new MessageEvent(type, { data })
		if (type === 'message') {
			this.onmessage?.(ev)
		}
		for (const listener of this.#listeners.get(type) ?? []) {
			listener(ev)
		}
	}
}

export function latestEventSource(): MockEventSource {
	const es = MockEventSource.instances[0]
	if (!es) {
		throw new Error('expected MockEventSource instance')
	}
	return es
}

export function resetMockEventSource() {
	MockEventSource.instances = []
}
