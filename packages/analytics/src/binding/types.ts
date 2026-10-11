import type {
	CollectionSlug,
	DataFromCollectionSlug,
	GeneratedTypes,
	PayloadRequest,
} from 'payload'

/**
 * A collection's generated document type once types are generated, else `Record<string, unknown>`
 * rather than Payload's `any`-indexed fallback.
 */
export type BindingDoc<TSlug extends CollectionSlug = CollectionSlug> =
	keyof GeneratedTypes extends never ? Record<string, unknown> : DataFromCollectionSlug<TSlug>

export type BindingContext = {
	req: PayloadRequest
	locale?: string
}

/**
 * Maps a document to the pathname its analytics were recorded under (`/blog/my-post`), which must
 * match what tracking reports. Memoized per document per request; null renders the empty state.
 */
export type PathResolver<TSlug extends CollectionSlug = CollectionSlug> = (
	doc: BindingDoc<TSlug>,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * Hostname a document's analytics were recorded under, for one Payload serving several sites: it
 * narrows a host-filtered source and always partitions the cache key. Null filters nothing.
 */
export type HostnameResolver<TSlug extends CollectionSlug = CollectionSlug> = (
	doc: BindingDoc<TSlug>,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * `path` wins over `pathField`; `item: true` counts documents as content shown elsewhere under ref
 * `<slug>:<id>`. At least one of the three is required; a path and `item` bind both reports.
 */
export type AnalyticsBinding<TSlug extends CollectionSlug = CollectionSlug> = {
	path?: PathResolver<TSlug>
	pathField?: string
	hostname?: string | HostnameResolver<TSlug>
	item?: boolean
	/**
	 * Top-level field holding a document's scope, so its panel reports that tenant, not the selected
	 * one; `false` reads the request's. Default `'tenant'` when scoped; boot fails if missing.
	 */
	scopeField?: string | false
}

/** Where a document's scope is read from; `false` reads the request's own. */
export type DocumentScopeField = string | false

/** A binding after option resolution, with the document's scope field filled. */
export type ResolvedBinding = Omit<AnalyticsBinding, 'scopeField'> & {
	scopeField: DocumentScopeField
}
