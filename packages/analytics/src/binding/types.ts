import type { PayloadRequest } from 'payload'

/** Document data as seen by a binding resolver: a plain record, field-shape agnostic. */
export type BindingDoc = Record<string, unknown>

export interface BindingContext {
	req: PayloadRequest
	locale?: string
}

/** Maps a document to its analytics path (URL pathname), or null when it has none yet. */
export type PathResolver = (
	doc: BindingDoc,
	ctx: BindingContext
) => string | null | Promise<string | null>

export type HostnameResolver = (doc: BindingDoc) => string

/**
 * Per-collection binding. `path` is the primary resolver; `pathField` is an explicit
 * field fallback used only when `path` is absent or returns null. At least one of the
 * two must be provided (validated at config resolve time).
 */
export interface AnalyticsBinding {
	path?: PathResolver
	pathField?: string
	hostname?: string | HostnameResolver
}

/** A binding after option resolution; identical shape, kept distinct for intent. */
export type ResolvedBinding = AnalyticsBinding
