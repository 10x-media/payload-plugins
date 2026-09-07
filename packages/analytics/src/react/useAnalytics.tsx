'use client'

import { useContext } from 'react'
import { type AnalyticsApi, AnalyticsContext } from './AnalyticsProvider'

/**
 * The tracker for the surrounding `<AnalyticsProvider>`. Throws outside one, because a
 * silently dead `track` is worse than a build-time mistake.
 */
export const useAnalytics = (): AnalyticsApi => {
	const api = useContext(AnalyticsContext)
	if (!api) {
		throw new Error('analytics: useAnalytics must be called inside an <AnalyticsProvider>')
	}
	return api
}
