'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { fetchGoals, type GoalsResponse } from './fetchGoals'

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
 * Fetches the caller-scope goal list for the admin goal picker. `goals` stays null while
 * the fetch is in flight, when it fails, and when there is no authenticated user yet, so
 * a picker can tell "still loading" from "this scope has no goals". Goals fetched for a
 * previous user are never returned while a new user's fetch is pending.
 */
export const useAnalyticsGoals = (): AnalyticsGoals => {
	const { user } = useAuth()
	const {
		config: {
			routes: { api },
			serverURL,
		},
	} = useConfig()
	const userKey = String(user?.id ?? '')
	const [state, setState] = useState<{ key: string; data: AnalyticsGoals }>({
		data: EMPTY,
		key: '',
	})

	useEffect(() => {
		if (!userKey) {
			setState({ data: EMPTY, key: '' })
			return
		}
		let cancelled = false
		fetchGoals(serverURL ?? '', api, userKey)
			.then(({ collection, goals }) => {
				if (!cancelled) setState({ data: { collection, error: false, goals }, key: userKey })
			})
			.catch(() => {
				if (!cancelled) setState({ data: FAILED, key: userKey })
			})
		return () => {
			cancelled = true
		}
	}, [api, serverURL, userKey])

	return state.key === userKey ? state.data : EMPTY
}
