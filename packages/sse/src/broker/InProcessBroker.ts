import type { EventBroker, RealtimeEvent } from './types'

type ErrorLog = { error: (message: string, err?: unknown) => void }

export class InProcessBroker implements EventBroker {
	#listeners = new Map<string, Set<(event: RealtimeEvent) => void>>()
	#log?: ErrorLog

	constructor(log?: ErrorLog) {
		this.#log = log
	}

	publish(event: RealtimeEvent): void {
		const listeners = this.#listeners.get(event.topic)
		if (!listeners) return
		for (const callback of listeners) {
			try {
				callback(event)
			} catch (err) {
				this.#log?.error('@10x-media/sse: subscriber failed', err)
			}
		}
	}

	subscribe(topic: string, callback: (event: RealtimeEvent) => void): () => void {
		let listeners = this.#listeners.get(topic)
		if (!listeners) {
			listeners = new Set()
			this.#listeners.set(topic, listeners)
		}
		listeners.add(callback)
		return () => {
			listeners.delete(callback)
			if (listeners.size === 0) {
				this.#listeners.delete(topic)
			}
		}
	}

	async destroy(): Promise<void> {
		this.#listeners.clear()
	}
}
