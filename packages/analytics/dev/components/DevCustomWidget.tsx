import { BarList } from '@10x-media/analytics/client'
import {
	formatMetricValue,
	readForWidgetBreakdown,
	widgetCardStyle,
	widgetLabelStyle,
} from '@10x-media/analytics/rsc'
import type { WidgetServerProps } from 'payload'

/**
 * Demo of the public custom-widget API: read through the plugin's helpers and render
 * inside the exported card chrome so a registered widget matches the built-ins.
 */
export default async function DevCustomWidget(props: WidgetServerProps) {
	const locale = props.req.i18n.language ?? 'en-US'
	const result = await readForWidgetBreakdown({
		req: props.req,
		metric: 'pageviews',
		dimension: 'source',
		timeframe: 'last30days',
		limit: 5,
		now: new Date(),
	})
	if (result.status !== 'ok') {
		return (
			<div style={widgetCardStyle}>
				<span style={widgetLabelStyle}>Custom: Top sources</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>No data</span>
			</div>
		)
	}
	return (
		<div style={widgetCardStyle}>
			<span style={widgetLabelStyle}>Custom: Top sources</span>
			<BarList
				data={result.rows.map((r) => ({
					label: r.label,
					value: r.value,
					display: formatMetricValue('pageviews', r.value, locale),
				}))}
				emptyLabel="No data"
			/>
		</div>
	)
}
