import type { WikiExcludeOptions } from '../options'

/**
 * Payload's own bookkeeping collections, excluded before the host's list is
 * applied. They exist to make the admin work rather than to be worked in, so a
 * guide about them documents nothing an editor can act on, and offering them in
 * the target pickers is noise.
 *
 * Slugs are hardcoded rather than read from Payload's exports: several are only
 * conditionally registered, and importing each feature's config to learn its
 * slug would pull server-only modules into a config-time list.
 */
export const PAYLOAD_INTERNAL_COLLECTIONS = [
	'payload-folders',
	'payload-jobs',
	'payload-locked-documents',
	'payload-migrations',
	'payload-preferences',
	'payload-query-presets',
] as const

/** Payload's own bookkeeping globals, excluded on the same grounds. */
export const PAYLOAD_INTERNAL_GLOBALS = ['payload-jobs-stats'] as const

/** Exclusions normalized per entity kind, sorted and deduplicated. */
export type ResolvedWikiExclude = {
	blocks: string[]
	collections: string[]
	globals: string[]
}

const merge = (...lists: readonly (readonly string[])[]): string[] =>
	[...new Set(lists.flat())].sort()

/**
 * Every slug the plugin leaves untouched, kept apart per entity kind because
 * Payload only enforces slug uniqueness within one kind: a collection, a
 * global, and a block may all be called `settings`, and one flat list would
 * exclude three unrelated things at once.
 *
 * The wiki's own collections join the collection exclusions, so every consumer
 * has a single set to check.
 */
export const resolveExcluded = (
	exclude: undefined | WikiExcludeOptions,
	slugs: { media: string; pages: string }
): ResolvedWikiExclude => ({
	blocks: merge(exclude?.blocks ?? []),
	collections: merge(
		PAYLOAD_INTERNAL_COLLECTIONS,
		[slugs.media, slugs.pages],
		exclude?.collections ?? []
	),
	globals: merge(PAYLOAD_INTERNAL_GLOBALS, exclude?.globals ?? []),
})
