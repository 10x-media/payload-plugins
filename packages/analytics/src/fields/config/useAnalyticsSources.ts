'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { fetchSources, type WireSource } from './fetchSources'
import { EMPTY_SOURCES, type KeyedSources, resolveSourcesState } from './sourcesState'

export interface AnalyticsSources {
	sources: WireSource[] | null
	defaultId: string | null
}

/**
 * Fetches the caller-scope source list for widget config pickers, sharing the
 * per-user cache `fetchSources` already keeps. `sources` and `defaultId` stay
 * null until the fetch resolves, on a failed fetch, or when there is no
 * authenticated user yet; consumers fall back to their static option list in
 * that window. Sources fetched for a previous user are never returned while
 * a new user's fetch is pending.
 */
export const useAnalyticsSources = (): AnalyticsSources => {
	const { user } = useAuth()
	const {
		config: {
			routes: { api },
			serverURL,
		},
	} = useConfig()
	const userKey = String(user?.id ?? '')
	const [state, setState] = useState<KeyedSources>({ key: '', data: EMPTY_SOURCES })

	useEffect(() => {
		if (!userKey) {
			setState({ key: '', data: EMPTY_SOURCES })
			return
		}
		let cancelled = false
		fetchSources(serverURL ?? '', api, userKey)
			.then(({ defaultId, sources }) => {
				if (!cancelled) setState({ key: userKey, data: { sources, defaultId } })
			})
			.catch(() => {
				if (!cancelled) setState({ key: userKey, data: EMPTY_SOURCES })
			})
		return () => {
			cancelled = true
		}
	}, [api, serverURL, userKey])

	return resolveSourcesState(state, userKey)
}
