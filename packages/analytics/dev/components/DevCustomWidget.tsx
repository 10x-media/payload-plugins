import { BarList } from '@10x-media/analytics/client'
import { formatMetricValue, readForWidgetBreakdown } from '@10x-media/analytics/rsc'
import type { WidgetServerProps } from 'payload'

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
	const style = {
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '0.5rem',
		padding: '1rem',
	}
	if (result.status !== 'ok') {
		return (
			<div style={style}>
				<span style={{ fontWeight: 600 }}>Custom widget: top sources</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>No data</span>
			</div>
		)
	}
	return (
		<div style={style}>
			<span style={{ fontWeight: 600 }}>Custom widget: top sources</span>
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
