import type { CollectionAfterChangeHook } from 'payload'

import type { SSEOperation } from '../broker/types'
import { getRuntime } from '../plugin/runtime'
import { publishThin } from './publishThin'

/** Set on `req.context` to suppress SSE publishes for that write. */
export const SSE_SKIP = '@10x-media/sse/skip'

export type AfterChangeHookDeps = {
	collection: string
	events: SSEOperation[]
}

export const createAfterChangeHook = (deps: AfterChangeHookDeps): CollectionAfterChangeHook => {
	const { collection, events } = deps
	return async ({ doc, operation, req }) => {
		const op: SSEOperation = operation === 'create' ? 'create' : 'update'
		if (!events.includes(op)) return doc
		if (req.context?.[SSE_SKIP]) return doc
		if (req.query?.autosave) return doc

		const runtime = getRuntime(req.payload)
		if (!runtime) return doc

		const docId = String((doc as { id?: unknown }).id)
		await publishThin({
			collection,
			docId,
			operation: op,
			doc,
			req,
			broker: runtime.broker,
			scope: runtime.scope,
		})
		return doc
	}
}
