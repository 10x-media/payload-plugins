import type { Payload, ServerProps } from 'payload'
import { createPayloadRequest } from 'payload'

import { getRegistry } from '../plugin/registry'
import { startableCollectionSlugs } from '../plugin/startable'
import { resolveTargetFilters, type TargetFilterMap } from './filterTargets'

/**
 * The target filters for the signed-in viewer, resolved by the provider and by the header on
 * every page. Without a viewer nothing is startable, so a screen rendered before login never
 * offers the switcher.
 */
export const viewerTargetFilters = async ({
	i18n,
	payload,
	server,
	user,
}: {
	i18n: ServerProps['i18n']
	payload: Payload
	server?: ServerProps['server']
	user: ServerProps['user']
}): Promise<TargetFilterMap> => {
	const options = getRegistry(payload.config)
	if (!user || !options) {
		return {}
	}
	const startable = startableCollectionSlugs(payload.config.collections, options)
	if (!options.access.filterTargets) {
		return Object.fromEntries(startable.map((slug) => [slug, true as const]))
	}
	const headers = (await server?.getHeaders()) ?? new Headers()
	const req = await createPayloadRequest({ payload, req: { headers, i18n: i18n as never }, user })
	return resolveTargetFilters({ collections: startable, options, req })
}
