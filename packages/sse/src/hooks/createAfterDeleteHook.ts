import type { CollectionAfterDeleteHook } from 'payload'

import type { RealtimeEvent, SSEOperation } from '../broker/types'
import { getRuntime } from '../plugin/runtime'
import { SSE_SKIP } from './createAfterChangeHook'

export type AfterDeleteHookDeps = {
	collection: string
	events: SSEOperation[]
}

const publishThin = (args: {
	collection: string
	docId: string
	broker: { publish: (event: RealtimeEvent) => void }
}): void => {
	const { collection, docId, broker } = args
	const operation: SSEOperation = 'delete'
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

export const createAfterDeleteHook = (deps: AfterDeleteHookDeps): CollectionAfterDeleteHook => {
	const { collection, events } = deps
	return ({ doc, req }) => {
		if (!events.includes('delete')) return doc
		if (req.context?.[SSE_SKIP]) return doc

		const runtime = getRuntime(req.payload)
		if (!runtime) return doc

		const docId = String((doc as { id?: unknown }).id)
		publishThin({
			collection,
			docId,
			broker: runtime.broker,
		})
		return doc
	}
}
