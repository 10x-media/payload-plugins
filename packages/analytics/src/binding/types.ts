import type { PayloadRequest } from 'payload'

/** Document data as seen by a binding resolver: a plain record, field-shape agnostic. */
export type BindingDoc = Record<string, unknown>

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
export type PathResolver = (
	doc: BindingDoc,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * Maps a document to the hostname its analytics were recorded under, for
 * multi-domain setups where one Payload instance serves several sites. The
 * resolved hostname is passed to the adapter alongside the path so queries
 * filter to that site's traffic. Runs on the server right before each
 * per-document adapter read, with the same `(doc, ctx)` as {@link PathResolver}.
 * Return null (or omit `hostname` entirely) to apply no hostname filter, which
 * queries across every domain the data source records. A static string works
 * for single-domain-per-collection setups; sync one-argument functions remain
 * supported.
 */
export type HostnameResolver = (
	doc: BindingDoc,
	ctx: BindingContext
) => string | null | Promise<string | null>

/**
 * Per-collection binding. `path` is the primary resolver; `pathField` is an explicit
 * field fallback used only when `path` is absent or returns null. At least one of the
 * two must be provided (validated at config resolve time).
 */
export type AnalyticsBinding = {
	path?: PathResolver
	pathField?: string
	hostname?: string | HostnameResolver
}

/** A binding after option resolution; identical shape, kept distinct for intent. */
export type ResolvedBinding = AnalyticsBinding
