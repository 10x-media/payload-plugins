import type { Payload } from 'payload'

import { collectionBySlug } from '../ids'
import type { ResolvedOptions } from '../types'

/**
 * Auth collections that exist on the booted instance but were missing when this
 * plugin ran. `relationTo` and `afterLogout` snapshot `config.collections`, so a
 * later plugin's collection would be startable and then fail open on logout.
 */
export const missingHookedAuthSlugs = (
	liveAuthSlugs: string[],
	hookedAuthSlugs: readonly string[],
	targets: string[] | undefined
): string[] => {
	const hooked = new Set(hookedAuthSlugs)
	const required = targets ?? liveAuthSlugs
	return required.filter((slug) => !hooked.has(slug))
}

export const liveAuthSlugsOf = (payload: Payload, recordsSlug: string): string[] =>
	Object.values(payload.collections)
		.filter((collection) => collection.config.auth && collection.config.slug !== recordsSlug)
		.map((collection) => collection.config.slug)

export const assertHookedAuthCollections = (
	payload: Payload,
	options: ResolvedOptions,
	hookedAuthSlugs: readonly string[]
): void => {
	if (options.targets) {
		for (const slug of options.targets) {
			if (!collectionBySlug(payload, slug)) {
				throw new Error(
					`@10x-media/impersonation: target collection "${slug}" is not in the config. Register impersonation after plugins that add auth collections.`
				)
			}
		}
	}

	const missing = missingHookedAuthSlugs(
		liveAuthSlugsOf(payload, options.collectionSlug),
		hookedAuthSlugs,
		options.targets
	)
	const first = missing[0]
	if (first) {
		throw new Error(
			`@10x-media/impersonation: auth collection "${first}" was registered after this plugin. List impersonation after plugins that add auth collections.`
		)
	}
}
