'use client'

import { useAnalytics } from '@10x-media/analytics/react'

/**
 * The `signup` goal's other half: a custom event tracked by hand. No provider wraps this
 * tree, so it exercises `useAnalytics` falling back to the tracker `AnalyticsScripts`
 * booted in the layout.
 */
export const SignupButton = () => {
	const { track } = useAnalytics()
	return (
		<button onClick={() => track('signup', { plan: 'pro' })} type="button">
			Sign up
		</button>
	)
}
