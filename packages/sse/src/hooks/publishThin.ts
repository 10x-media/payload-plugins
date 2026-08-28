import type { PayloadRequest } from 'payload'

import type { RealtimeEvent, SSEOperation } from '../broker/types'
import { scopedTopic } from '../scope/resolveScope'
import { SCOPE_WILDCARD, type SSEScopeOptions } from '../scope/types'

const publishOne = (args: {
	broker: { publish: (event: RealtimeEvent) => void }
	event: RealtimeEvent
}): void => {
	try {
		args.broker.publish(args.event)
	} catch {
		// Hook must never fail the write
	}
}

export const publishThin = async (args: {
	collection: string
	docId: string
	operation: SSEOperation
	doc: unknown
	req: PayloadRequest
	broker: { publish: (event: RealtimeEvent) => void }
	scope: SSEScopeOptions | false
}): Promise<void> => {
	const { collection, docId, operation, doc, req, broker, scope } = args
	const timestamp = Date.now()

	let scopeId: string | null = null
	if (scope) {
		try {
			scopeId = await scope.resolveDoc({ doc, req })
		} catch {
			scopeId = null
		}
	}

	const topics: string[] = [`${collection}:${docId}`]
	if (scope && scopeId) {
		topics.push(scopedTopic(scopeId, collection), scopedTopic(SCOPE_WILDCARD, collection))
	} else if (!scope) {
		topics.push(collection)
	}

	for (const topic of topics) {
		publishOne({
			broker,
			event: {
				id: `${timestamp}:${collection}:${docId}:${operation}:${topic}`,
				topic,
				event: operation,
				collection,
				docId,
				operation,
				timestamp,
				...(scopeId ? { scope: scopeId } : {}),
			},
		})
	}
}
