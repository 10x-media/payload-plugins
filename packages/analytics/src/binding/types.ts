import type {
	CollectionSlug,
	DataFromCollectionSlug,
	GeneratedTypes,
	PayloadRequest,
} from 'payload'

/**
 * Document data as seen by a binding resolver. With generated types augmented
 * (a consumer project after `payload generate:types`) this is the collection's
 * generated document type, so a resolver written inline under `collections.<slug>`
 * receives that collection's typed doc. Without augmentation (this repo, or before
 * first generation) it degrades to a plain `Record<string, unknown>` rather than
 * the `any`-indexed fallback Payload would otherwise supply.
 */
export type BindingDoc<TSlug extends CollectionSlug = CollectionSlug> =
	keyof GeneratedTypes extends never ? Record<string, unknown> : DataFromCollectionSlug<TSlug>

export type BindingContext = {
	req: PayloadRequest
	locale?: string
}

/**
 * Maps a document to the URL pathname its analytics were recorded under, e.g.
 * `/blog/my-post`. The resolved path is what every display field and per-document
 * read filters adapter queries by, so it must match the paths your tracking
 * reports. Runs on the server for each document view that renders an analytics
 * field (memoized once per document per request) and again for warm-cache reads.
 * `ctx.req` is the current `PayloadRequest`, so related documents can be looked
 * up through `ctx.req.payload`. Return null when the document has no URL yet
 * (for example unsaved or unpublished); the field then renders its empty state
 * instead of querying.
 */
export type PathResolver<TSlug extends CollectionSlug = CollectionSlug> = (
	doc: BindingDoc<TSlug>,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * Maps a document to the hostname its analytics were recorded under, for
 * multi-domain setups where one Payload instance serves several sites. The
 * resolved hostname is passed to the adapter alongside the path; adapters that
 * expose a host filter (PostHog `properties.$host`, GA4 `hostName`, Plausible
 * `event:hostname`) narrow the query to that site's traffic, and the hostname
 * always partitions the cache key. Adapters without a native host filter (umami,
 * and the native engine, whose rollups are not yet keyed by hostname) ignore it.
 * Runs on the server right before each per-document adapter read, with the same
 * `(doc, ctx)` as {@link PathResolver}. Return null (or omit `hostname` entirely)
 * to apply no hostname filter. A static string works for single-domain-per-collection
 * setups; sync one-argument functions remain supported.
 */
export type HostnameResolver<TSlug extends CollectionSlug = CollectionSlug> = (
	doc: BindingDoc<TSlug>,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * Per-collection binding. `path` is the primary resolver; `pathField` is an explicit
 * field fallback used only when `path` is absent or returns null. At least one of the
 * two must be provided (validated at config resolve time).
 */
export type AnalyticsBinding<TSlug extends CollectionSlug = CollectionSlug> = {
	path?: PathResolver<TSlug>
	pathField?: string
	hostname?: string | HostnameResolver<TSlug>
}

/** A binding after option resolution; identical shape, kept distinct for intent. */
export type ResolvedBinding = AnalyticsBinding
