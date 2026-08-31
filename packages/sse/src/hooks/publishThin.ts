import type { PayloadRequest } from 'payload'

import type { RealtimeEvent, SSEOperation } from '../broker/types'
import { scopedTopic } from '../scope/resolveScope'
import { SCOPE_WILDCARD, type SSEScopeOptions } from '../scope/types'

const publishOne = (args: {
	broker: { publish: (event: RealtimeEvent) => void }
	event: RealtimeEvent
	log?: { error: (message: string, err?: unknown) => void }
}): void => {
	try {
		args.broker.publish(args.event)
	} catch (err) {
		args.log?.error('@10x-media/sse: publish failed', err)
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
		} catch (err) {
			req.payload.logger.error(
				`@10x-media/sse: scope.resolveDoc threw: ${err instanceof Error ? err.message : String(err)}`
			)
			scopeId = null
		}
	}

	const topics: string[] = [`${collection}:${docId}`]
	if (scope) {
		if (scopeId) {
			topics.push(scopedTopic(scopeId, collection))
		} else {
			req.payload.logger.warn(
				`@10x-media/sse: no scope resolved for ${collection}:${docId}; publishing to wildcard only`
			)
		}
		topics.push(scopedTopic(SCOPE_WILDCARD, collection))
	} else {
		topics.push(collection)
	}

	for (const topic of topics) {
		publishOne({
			broker,
			log: req.payload.logger,
			event: {
				// Never embed docId: gated deletes strip docId/data but keep `id` on the wire.
				id: `${timestamp}:${collection}:${operation}:${topic}`,
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
