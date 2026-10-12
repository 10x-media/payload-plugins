'use client'

import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { apiPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import { useRequestScope } from '../ui/data/useRequestScope'
import { fetchGoals, type GoalsResponse } from './fetchGoals'

/** @beta */
export interface AnalyticsGoals {
	/** Null until the fetch settles, and on a failed one: not the same thing as none. */
	goals: GoalsResponse['goals'] | null
	collection: GoalsResponse['collection']
	/** The fetch settled in failure, so a picker can say so instead of claiming none exist. */
	error: boolean
}

const EMPTY: AnalyticsGoals = { collection: null, error: false, goals: null }
const FAILED: AnalyticsGoals = { collection: null, error: true, goals: null }

/**
 * The caller scope's goals for an admin picker: `goals` is null while loading, failed or signed out,
 * so "loading" differs from "none". Another scope's goals never show while this one loads.
 *
 * @beta
 */
export const useAnalyticsGoals = (): AnalyticsGoals => {
	const { config } = useConfig()
	const url = apiPath(config, analyticsRoutes(config).goals)
	const scope = useRequestScope()
	const [state, setState] = useState<{ key: string; data: AnalyticsGoals }>({
		data: EMPTY,
		key: '',
	})

	useEffect(() => {
		if (!scope) {
			setState({ data: EMPTY, key: '' })
			return
		}
		let cancelled = false
		fetchGoals(url, scope)
			.then(({ collection, goals }) => {
				if (!cancelled) setState({ data: { collection, error: false, goals }, key: scope })
			})
			.catch(() => {
				if (!cancelled) setState({ data: FAILED, key: scope })
			})
		return () => {
			cancelled = true
		}
	}, [url, scope])

	return state.key === scope ? state.data : EMPTY
}
