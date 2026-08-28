import type { CollectionAfterDeleteHook } from 'payload'

import type { SSEOperation } from '../broker/types'
import { getRuntime } from '../plugin/runtime'
import { SSE_SKIP } from './createAfterChangeHook'
import { publishThin } from './publishThin'

export type AfterDeleteHookDeps = {
	collection: string
	events: SSEOperation[]
}

export const createAfterDeleteHook = (deps: AfterDeleteHookDeps): CollectionAfterDeleteHook => {
	const { collection, events } = deps
	return async ({ doc, req }) => {
		if (!events.includes('delete')) return doc
		if (req.context?.[SSE_SKIP]) return doc

		const runtime = getRuntime(req.payload)
		if (!runtime) return doc

		const docId = String((doc as { id?: unknown }).id)
		await publishThin({
			collection,
			docId,
			operation: 'delete',
			doc,
			req,
			broker: runtime.broker,
			scope: runtime.scope,
		})
		return doc
	}
}
