import { headers as nextHeaders } from 'next/headers'
import type { Payload, ServerProps } from 'payload'
import { createLocalReq } from 'payload'
import { cache } from 'react'

import { getRegistry } from '../plugin/registry'
import { startableCollectionSlugs } from '../plugin/startable'
import { resolveTargetFilters, type TargetFilterMap } from './filterTargets'

/**
 * The target filters for the signed-in viewer, resolved once per admin render: the provider and
 * the header share it. Without a viewer nothing is startable, so a screen rendered before login
 * never offers the switcher.
 */
export const viewerTargetFilters = cache(
	async (
		user: ServerProps['user'],
		i18n: ServerProps['i18n'],
		payload: Payload
	): Promise<TargetFilterMap> => {
		const options = getRegistry(payload.config)
		if (!user || !options) {
			return {}
		}
		const startable = startableCollectionSlugs(payload.config.collections, options)
		if (!options.access.filterTargets) {
			return Object.fromEntries(startable.map((slug) => [slug, true as const]))
		}
		const headerList = await nextHeaders()
		const req = await createLocalReq({ req: { headers: headerList, i18n } as never, user }, payload)
		return resolveTargetFilters({ collections: startable, options, req })
	}
)
