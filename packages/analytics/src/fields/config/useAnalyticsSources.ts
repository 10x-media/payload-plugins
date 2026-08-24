'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { fetchSources, type WireSource } from './fetchSources'

export interface AnalyticsSources {
	sources: WireSource[] | null
	defaultId: string | null
}

const EMPTY: AnalyticsSources = { sources: null, defaultId: null }

/**
 * Fetches the caller-scope source list for widget config pickers, sharing the
 * per-user cache `fetchSources` already keeps. `sources` and `defaultId` stay
 * null until the fetch resolves, on a failed fetch, or when there is no
 * authenticated user yet; consumers fall back to their static option list in
 * that window.
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
	const [state, setState] = useState<AnalyticsSources>(EMPTY)

	useEffect(() => {
		if (!userKey) {
			setState(EMPTY)
			return
		}
		let cancelled = false
		fetchSources(serverURL ?? '', api, userKey)
			.then(({ defaultId, sources }) => {
				if (!cancelled) setState({ sources, defaultId })
			})
			.catch(() => {
				if (!cancelled) setState(EMPTY)
			})
		return () => {
			cancelled = true
		}
	}, [api, serverURL, userKey])

	return state
}
