/**
 * Payload's own bookkeeping collections, left out of the view's collection and
 * document pickers. They exist to make the admin work rather than to be worked
 * in, and some have no list to pick from at all (`payload-kv` breaks the list
 * drawer). Same list as admin-wiki's, plus the key-value store.
 *
 * Slugs are hardcoded rather than read from Payload's exports: several are only
 * conditionally registered, and importing each feature's config to learn its
 * slug would pull server-only modules into the view.
 */
export const PAYLOAD_INTERNAL_COLLECTIONS: readonly string[] = [
	'payload-folders',
	'payload-jobs',
	'payload-kv',
	'payload-locked-documents',
	'payload-migrations',
	'payload-preferences',
	'payload-query-presets',
]

/** Payload's own bookkeeping globals, left out on the same grounds. */
export const PAYLOAD_INTERNAL_GLOBALS: readonly string[] = ['payload-jobs-stats']
