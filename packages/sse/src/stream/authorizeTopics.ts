import type { PayloadRequest, Where } from 'payload'

import { SCOPE_WILDCARD, type ScopeSelection, type SSEScopeOptions } from '../scope/types'

export type AuthorizedTopic = {
	topic: string
	collection: string
	docId?: string
	mode: 'thin' | 'enriched'
	/** Concrete scopes (or wildcard) whose broker channels this wide topic should join. */
	scopes?: string[] | typeof SCOPE_WILDCARD
	/** Drop events the subscriber cannot read. Set on Where-scoped collection-wide topics. */
	gate?: 'per-event'
}

export type AuthorizeTopicsResult =
	| { ok: true; topics: AuthorizedTopic[] }
	| { ok: false; status: 400 | 403; message: string }

export type AuthorizeTopicsDeps = {
	req: PayloadRequest
	topics: string[]
	collections: Record<string, { thinEvents: boolean }>
	scope?: SSEScopeOptions | false
}

const MAX_TOPICS = 32

const parseTopic = (
	raw: string
): { ok: true; collection: string; docId?: string; presence?: true } | { ok: false } => {
	if (!raw) return { ok: false }
	const segments = raw.split(':')
	if (segments.length === 1) {
		const collection = segments[0]
		if (!collection) return { ok: false }
		return { ok: true, collection }
	}
	if (segments.length === 2) {
		const [collection, docId] = segments
		if (!collection || !docId) return { ok: false }
		return { ok: true, collection, docId }
	}
	if (segments.length === 3 && segments[0] === 'presence') {
		const collection = segments[1]
		const docId = segments[2]
		if (!collection || !docId) return { ok: false }
		return { ok: true, collection, docId, presence: true }
	}
	return { ok: false }
}

const isWhere = (value: unknown): value is Where =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const toScopes = (
	selection: Exclude<ScopeSelection, null>
): NonNullable<AuthorizedTopic['scopes']> => {
	if (selection === SCOPE_WILDCARD) return SCOPE_WILDCARD
	return Array.isArray(selection) ? selection : [selection]
}

const withWideScope = (
	topic: AuthorizedTopic,
	selection: Exclude<ScopeSelection, null>,
	gate?: 'per-event'
): AuthorizedTopic => {
	if (topic.docId !== undefined) return topic
	return {
		...topic,
		scopes: toScopes(selection),
		...(gate ? { gate } : {}),
	}
}

/**
 * Connect-time topic authorization. Returns a result object; never throws HTTP.
 */
export const authorizeTopics = async (
	deps: AuthorizeTopicsDeps
): Promise<AuthorizeTopicsResult> => {
	const { req, topics, collections, scope } = deps

	if (topics.length === 0) {
		return { ok: false, status: 400, message: 'topics query is required' }
	}
	if (topics.length > MAX_TOPICS) {
		return { ok: false, status: 400, message: `at most ${MAX_TOPICS} topics allowed` }
	}

	let selection: ScopeSelection = null
	if (scope) {
		try {
			selection = await scope.resolveRequest({ req })
		} catch (err) {
			req.payload.logger.error(
				`@10x-media/sse: scope.resolveRequest threw: ${err instanceof Error ? err.message : String(err)}`
			)
			selection = null
		}
		if (selection === null) {
			return { ok: false, status: 403, message: 'scope required' }
		}
	}

	const authorized: AuthorizedTopic[] = []

	for (const topic of topics) {
		const parsed = parseTopic(topic)
		if (!parsed.ok) {
			return { ok: false, status: 403, message: `invalid topic: ${topic}` }
		}

		const { collection: slug, docId, presence } = parsed
		if (!(slug in collections)) {
			return { ok: false, status: 403, message: `collection not enabled for sse: ${slug}` }
		}
		const collection = req.payload.collections[slug]
		if (!collection) {
			return { ok: false, status: 403, message: `unknown collection: ${slug}` }
		}

		const readAccess = collection.config.access?.read
		const accessResult: unknown =
			typeof readAccess === 'function' ? await readAccess({ req }) : (readAccess ?? true)

		if (accessResult === false) {
			return { ok: false, status: 403, message: `forbidden topic: ${topic}` }
		}

		const mode: AuthorizedTopic['mode'] = presence
			? 'thin'
			: collections[slug]?.thinEvents === false
				? 'enriched'
				: 'thin'

		const stamp = (entry: AuthorizedTopic, gate?: 'per-event'): AuthorizedTopic =>
			selection === null ? entry : withWideScope(entry, selection, gate)

		if (accessResult === true) {
			authorized.push(
				stamp(
					docId === undefined
						? { topic, collection: slug, mode }
						: { topic, collection: slug, docId, mode }
				)
			)
			continue
		}

		if (!isWhere(accessResult)) {
			return { ok: false, status: 403, message: `forbidden topic: ${topic}` }
		}

		if (docId === undefined) {
			if (selection === null) {
				return {
					ok: false,
					status: 403,
					message: `collection-wide topic forbidden under Where access: ${topic}`,
				}
			}
			authorized.push(stamp({ topic, collection: slug, mode }, 'per-event'))
			continue
		}

		const counted = await req.payload.count({
			collection: slug,
			where: {
				and: [accessResult, { id: { equals: docId } }],
			},
			req,
			overrideAccess: false,
		})

		if (counted.totalDocs < 1) {
			return { ok: false, status: 403, message: `forbidden topic: ${topic}` }
		}

		authorized.push({ topic, collection: slug, docId, mode })
	}

	return { ok: true, topics: authorized }
}
