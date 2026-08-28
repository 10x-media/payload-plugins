import type { PayloadRequest, Where } from 'payload'

export type AuthorizedTopic = {
	topic: string
	collection: string
	docId?: string
	mode: 'thin' | 'enriched'
}

export type AuthorizeTopicsResult =
	| { ok: true; topics: AuthorizedTopic[] }
	| { ok: false; status: 400 | 403; message: string }

export type AuthorizeTopicsDeps = {
	req: PayloadRequest
	topics: string[]
	collections: Record<string, { thinEvents: boolean }>
}

const MAX_TOPICS = 32

const parseTopic = (
	raw: string
): { ok: true; collection: string; docId?: string } | { ok: false } => {
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
	return { ok: false }
}

const isWhere = (value: unknown): value is Where =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Connect-time topic authorization. Returns a result object; never throws HTTP.
 */
export const authorizeTopics = async (
	deps: AuthorizeTopicsDeps
): Promise<AuthorizeTopicsResult> => {
	const { req, topics, collections } = deps

	if (topics.length === 0) {
		return { ok: false, status: 400, message: 'topics query is required' }
	}
	if (topics.length > MAX_TOPICS) {
		return { ok: false, status: 400, message: `at most ${MAX_TOPICS} topics allowed` }
	}

	const authorized: AuthorizedTopic[] = []

	for (const topic of topics) {
		const parsed = parseTopic(topic)
		if (!parsed.ok) {
			return { ok: false, status: 403, message: `invalid topic: ${topic}` }
		}

		const { collection: slug, docId } = parsed
		const collection = req.payload.collections[slug]
		if (!collection) {
			return { ok: false, status: 403, message: `unknown collection: ${slug}` }
		}

		const readAccess = collection.config.access?.read
		const accessResult: unknown =
			typeof readAccess === 'function' ? await readAccess({ req }) : true

		if (accessResult === false) {
			return { ok: false, status: 403, message: `forbidden topic: ${topic}` }
		}

		const mode: AuthorizedTopic['mode'] =
			collections[slug]?.thinEvents === false ? 'enriched' : 'thin'

		if (accessResult === true) {
			authorized.push(
				docId === undefined
					? { topic, collection: slug, mode }
					: { topic, collection: slug, docId, mode }
			)
			continue
		}

		if (!isWhere(accessResult)) {
			return { ok: false, status: 403, message: `forbidden topic: ${topic}` }
		}

		if (docId === undefined) {
			return {
				ok: false,
				status: 403,
				message: `collection-wide topic forbidden under Where access: ${topic}`,
			}
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
