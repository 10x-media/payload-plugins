import type { CollectionAfterChangeHook } from 'payload'

import type { RealtimeEvent, SSEOperation } from '../broker/types'
import { getRuntime } from '../plugin/runtime'

/** Set on `req.context` to suppress SSE publishes for that write. */
export const SSE_SKIP = '@10x-media/sse/skip'

export type AfterChangeHookDeps = {
	collection: string
	events: SSEOperation[]
}

const publishThin = (args: {
	collection: string
	docId: string
	operation: SSEOperation
	broker: { publish: (event: RealtimeEvent) => void }
}): void => {
	const { collection, docId, operation, broker } = args
	const timestamp = Date.now()
	const topics = [collection, `${collection}:${docId}`]
	for (const topic of topics) {
		const event: RealtimeEvent = {
			id: `${timestamp}:${collection}:${docId}:${operation}:${topic}`,
			topic,
			event: operation,
			collection,
			docId,
			operation,
			timestamp,
		}
		try {
			broker.publish(event)
		} catch {
			// Hook must never fail the write
		}
	}
}

export const createAfterChangeHook = (deps: AfterChangeHookDeps): CollectionAfterChangeHook => {
	const { collection, events } = deps
	return ({ doc, operation, req }) => {
		const op: SSEOperation = operation === 'create' ? 'create' : 'update'
		if (!events.includes(op)) return doc
		if (req.context?.[SSE_SKIP]) return doc

		const runtime = getRuntime(req.payload)
		if (!runtime) return doc

		const docId = String((doc as { id?: unknown }).id)
		publishThin({
			collection,
			docId,
			operation: op,
			broker: runtime.broker,
		})
		return doc
	}
}
