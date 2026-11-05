import { APIError, type CollectionSlug, type PayloadRequest } from 'payload'
import { resolvePathCached } from '../binding/resolvePath'
import type { BindingDoc } from '../binding/types'
import { analyticsError, errorResponse } from './errors'
import { getRuntime } from './runtime'

type BoundDocument =
	| { ok: true; data: BindingDoc; path: string | null }
	/** 404 covers missing, unreadable and unbound alike; 500 is this install failing. */
	| { ok: false; status: 404 | 500 }

/** An endpoint's answer for a bound document that did not load. */
export const unloadedDocumentResponse = (status: 404 | 500): Response =>
	status === 404
		? errorResponse(404, analyticsError('not_found', 'analytics: no such document'))
		: errorResponse(500, analyticsError('internal', 'analytics: document read failed'))

/**
 * Loads a bound document as the caller (no `overrideAccess`) and resolves its path. Missing,
 * unreadable and unbound are one uniform 404, so a read never confirms a document exists.
 */
export const resolveBoundDocument = async (args: {
	req: PayloadRequest
	collection: string
	id: string
}): Promise<BoundDocument> => {
	const { req, collection, id } = args
	const runtime = getRuntime(req.payload)
	const binding = runtime?.bindings[collection]
	if (!binding || !id) {
		return { ok: false, status: 404 }
	}
	let data: BindingDoc
	try {
		data = await req.payload.findByID({
			// A binding exists only under a key the `collections` option types as a collection slug.
			collection: collection as CollectionSlug,
			id,
			depth: 0,
			overrideAccess: false,
			user: req.user,
			req,
		})
	} catch (err) {
		if (err instanceof APIError && (err.status === 404 || err.status === 403)) {
			return { ok: false, status: 404 }
		}
		req.payload.logger?.error(`analytics: document read failed for "${collection}": ${String(err)}`)
		return { ok: false, status: 500 }
	}
	let path: string | null
	try {
		path = await resolvePathCached(binding, data, { req, locale: req.locale ?? undefined })
	} catch {
		path = null
	}
	return { ok: true, data, path }
}
