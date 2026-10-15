'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { requestSources, type SourcesNotice } from '../fields/config/fetchSources'
import { apiPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import { SourcesNoticeBanner } from '../ui/components/SourcesNoticeBanner'
import { useRequestScope } from '../ui/data/useRequestScope'

/**
 * The providers list's note to a tenant reading the platform's source until it adds its own. Read
 * past the shared cache: this list is where a source is added, and a cached listing outlives that.
 *
 * @beta
 */
export function ProvidersListNotice() {
	const { config } = useConfig()
	const url = apiPath(config, analyticsRoutes(config).sources)
	const scope = useRequestScope()
	const [read, setRead] = useState<{ scope: string; notice: SourcesNotice | undefined }>()

	useEffect(() => {
		if (!scope) {
			return
		}
		const controller = new AbortController()
		// A listing that fails says nothing here: the list itself works without the note.
		requestSources(url, controller.signal).then(
			(listing) => setRead({ scope, notice: listing.notice }),
			() => {}
		)
		return () => controller.abort()
	}, [url, scope])

	return <SourcesNoticeBanner notice={read?.scope === scope ? read.notice : undefined} />
}
