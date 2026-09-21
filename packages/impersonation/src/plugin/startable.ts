import type { CollectionSlug } from 'payload'

import type { ResolvedOptions } from '../types'

type Authish = boolean | { disableLocalStrategy?: unknown; useSessions?: boolean }

/**
 * Auth collections start will actually mint. Explicit `targets` is an allow
 * list. Otherwise local-strategy + sessions, unless the host supplied all
 * three session seams.
 */
export const isStartableAuthCollection = (
	collection: { auth?: Authish; slug: string },
	options: Pick<ResolvedOptions, 'collectionSlug' | 'session' | 'targets'>
): boolean => {
	if (!collection.auth || collection.slug === options.collectionSlug) {
		return false
	}
	if (options.targets) {
		return options.targets.includes(collection.slug as CollectionSlug)
	}
	const hasSeams = Boolean(
		options.session.issue && options.session.revoke && options.session.binding
	)
	if (hasSeams) {
		return true
	}
	if (collection.auth !== true) {
		if (collection.auth.disableLocalStrategy) {
			return false
		}
		if (collection.auth.useSessions === false) {
			return false
		}
	}
	return true
}

export const startableCollectionSlugs = (
	collections: { auth?: Authish; slug: string }[] | undefined,
	options: Pick<ResolvedOptions, 'collectionSlug' | 'session' | 'targets'>
): CollectionSlug[] =>
	(collections ?? [])
		.filter((collection) => isStartableAuthCollection(collection, options))
		.map(({ slug }) => slug as CollectionSlug)
