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
 */
export const resolveCollections = ({
	collections,
	cookiePrefix,
}: {
	collections: DualSessionPluginOptions['collections']
	cookiePrefix: string
}): ResolvedIsolatedCollection[] =>
	collections.map((entry) => {
		const { cookieName, scopes, slug }: IsolatedCollection =
			typeof entry === 'string' ? { slug: entry } : entry

		return {
			slug,
			cookieName: cookieName ?? getIsolatedCookieName({ cookiePrefix, slug }),
			scopes: scopes ?? ['frontend'],
		}
	})
