'use client'

import {
	type AnalyticsViewClientProps,
	Card,
	formatMetricValue,
	MetricCard,
	Toolbar,
	useView,
	ViewBreakdowns,
	ViewRealtime,
	ViewRoot,
	ViewTrend,
} from '@10x-media/analytics/client'
import { keys, type TranslationKey } from '@10x-media/analytics/i18n'
import { useTranslation } from '@payloadcms/ui'

/** A section of the host's own, reading the same answers the plugin's sections read. */
function DevHeadline({ locale }: { locale: string }) {
	const { queries } = useView()
	const { t } = useTranslation<Record<string, never>, TranslationKey>()
	const totals = queries.cards.data?.result.totals
	return (
		<Card as="section" className="analytics-view__panel">
			<div className="analytics-view__cards">
				<MetricCard
					label={t(keys.metricPageviews)}
					value={formatMetricValue('pageviews', totals?.pageviews, locale)}
				/>
				<MetricCard
					label={t(keys.metricVisitors)}
					value={formatMetricValue('visitors', totals?.visitors, locale)}
				/>
			</div>
		</Card>
	)
}

/**
 * `view.Component` as a host writes one: the plugin's frame and toolbar, a headline section of
 * its own, then the plugin's trend, live strip and breakdowns in an order of its choosing.
 */
export function DevAnalyticsView(props: AnalyticsViewClientProps) {
	return (
		<ViewRoot {...props}>
			<Toolbar />
			<DevHeadline locale={props.locale} />
			<ViewTrend />
			<ViewRealtime />
			<ViewBreakdowns />
		</ViewRoot>
	)
}
