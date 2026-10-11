'use client'

import { Toolbar } from './sections/Toolbar'
import { ViewRoot } from './ViewRoot'
import { ViewBreakdowns, ViewGoals, ViewOverview, ViewRealtime, ViewTrend } from './ViewSections'
import type { AnalyticsViewClientProps } from './viewProps'
import '../ui/analytics.css'

/**
 * Analytics dashboard: view frame and sections in reading order; its whole state is the URL. A
 * host's `view.Component` takes these same props and composes the exported pieces its own way.
 *
 * @beta
 */
export function AnalyticsViewClient(props: AnalyticsViewClientProps) {
	return (
		<ViewRoot {...props}>
			<Toolbar />
			<ViewOverview />
			<ViewTrend />
			<ViewBreakdowns />
			<ViewGoals />
			<ViewRealtime />
		</ViewRoot>
	)
}
