import { getIsolatedCookieName } from '../auth/cookies'
import type {
	DualSessionPluginOptions,
	IsolatedCollection,
	ResolvedIsolatedCollection,
} from '../types'

/**
 * Normalizes the `collections` option to full entries, filling the default cookie name
 * and scopes. Order is preserved because it is the priority order between isolated
 * collections.
 *
 * `isolate` is carried through as given rather than defaulted to `() => true`: its absence
 * is the signal that this collection needs no user to pick a cookie, which several callers
 * answer differently from a predicate that happens to always return true.
 */
export const resolveCollections = ({
	collections,
	cookiePrefix,
}: {
	collections: DualSessionPluginOptions['collections']
	cookiePrefix: string
}): ResolvedIsolatedCollection[] =>
	collections.map((entry) => {
		const { cookieName, isolate, scopes, slug }: IsolatedCollection =
			typeof entry === 'string' ? { slug: entry } : entry

		return {
			slug,
			cookieName: cookieName ?? getIsolatedCookieName({ cookiePrefix, slug }),
			...(isolate ? { isolate } : {}),
			scopes: scopes ?? ['frontend'],
		}
	})
