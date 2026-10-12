import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import { providerScopeWhere } from '../providers/resolver'
import { requestMemo } from './requestMemo'
import type { AnalyticsRuntime } from './runtime'

/** Far above any realistic provider count for one scope, far below a listing worth paging. */
const MAX_PROVIDER_DOCS = 200

/** Per request and user: a dashboard asks once per widget. */
const readable = requestMemo<ReadonlySet<string>>('readableProviders')

type ProvidersCollection = NonNullable<AnalyticsRuntime['providersCollection']>

/**
 * Enabled provider documents of one scope a reader reads through. A set `sourceAccess` decides
 * (false reads none, a `Where` narrows); otherwise the collection's own read access runs.
 */
const findReadable = async (
	collection: ProvidersCollection,
	req: PayloadRequest,
	where: Where
): Promise<Array<{ id: string | number }>> => {
	const query = {
		// The plugin registered this slug itself; `CollectionSlug` is the host's generated union.
		collection: collection.slug as CollectionSlug,
		limit: MAX_PROVIDER_DOCS,
		pagination: false,
		depth: 0,
		disableErrors: true,
		req,
	}
	if (!collection.sourceAccess) {
		const { docs } = await req.payload.find({
			...query,
			where,
			overrideAccess: false,
			user: req.user,
		})
		return docs
	}
	const verdict = await collection.sourceAccess({ req })
	if (verdict === false) {
		return []
	}
	const { docs } = await req.payload.find({
		...query,
		where: verdict === true ? where : { and: [where, verdict] },
		overrideAccess: true,
	})
	return docs
}

const load = async (
	collection: ProvidersCollection,
	req: PayloadRequest,
	scope: string | null
): Promise<ReadonlySet<string>> => {
	try {
		const docs = await findReadable(collection, req, {
			and: [{ enabled: { equals: true } }, providerScopeWhere(collection.scopeField, scope)],
		})
		return new Set(docs.map((doc) => String(doc.id)))
	} catch (err) {
		req.payload.logger?.warn(
			`analytics: readable provider lookup failed, treating the scope as having none: ${String(err)}`
		)
		return new Set()
	}
}

/**
 * Ids of a scope's enabled provider documents this user may read, memoized per scope and user. Null
 * when the install has no providers collection, so provider documents decide nothing.
 */
export const readableProviderDocIds = (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<ReadonlySet<string>> | null => {
	const collection = runtime.providersCollection
	if (!collection) {
		return null
	}
	return readable(req, {
		owner: runtime,
		key: JSON.stringify(scope),
		compute: () => load(collection, req, scope),
	})
}
