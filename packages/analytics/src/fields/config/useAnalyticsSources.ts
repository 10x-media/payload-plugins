'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { apiPath } from '../../plugin/apiPath'
import { analyticsRoutes } from '../../plugin/routes'
import { useRequestScope } from '../../ui/data/useRequestScope'
import { fetchSources, type WireSource } from './fetchSources'
import {
	EMPTY_SOURCES,
	FAILED_SOURCES,
	type KeyedSources,
	resolveSourcesState,
} from './sourcesState'

/** @beta */
export interface AnalyticsSources {
	sources: WireSource[] | null
	defaultId: string | null
	/** The fetch has yet to answer: not the same thing as a scope with no sources. */
	loading: boolean
	/** The fetch settled in failure, so a picker can say so instead of claiming none exist. */
	error: boolean
}

/**
 * Caller-scope source list for config pickers; `sources` stays null while pending, failed or
 * signed out, and a previous user's or tenant's list never shows while a new scope loads.
 *
 * @beta
 */
export const useAnalyticsSources = (): AnalyticsSources => {
	const { config } = useConfig()
	const url = apiPath(config, analyticsRoutes(config).sources)
	const scope = useRequestScope()
	const [state, setState] = useState<KeyedSources>({ key: '', data: EMPTY_SOURCES })

	useEffect(() => {
		if (!scope) {
			setState({ key: '', data: EMPTY_SOURCES })
			return
		}
		let cancelled = false
		fetchSources(url, scope)
			.then(({ defaultId, sources }) => {
				if (!cancelled) {
					setState({ key: scope, data: { defaultId, error: false, loading: false, sources } })
				}
			})
			.catch(() => {
				if (!cancelled) setState({ key: scope, data: FAILED_SOURCES })
			})
		return () => {
			cancelled = true
		}
	}, [url, scope])

	return resolveSourcesState(state, scope)
}
