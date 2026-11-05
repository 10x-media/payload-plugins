import { BarList } from '@10x-media/analytics/client'
import {
	formatMetricValue,
	readForWidgetBreakdown,
	WidgetBody,
	WidgetCard,
	WidgetEmpty,
} from '@10x-media/analytics/rsc'
import type { WidgetServerProps } from 'payload'

const TITLE = 'Custom: Top sources'
const EMPTY = 'No data'

/**
 * Demo of the public custom-widget API: read through the plugin's helpers and render inside
 * the exported card, so a registered widget stands in its row like the built-ins. Each row's
 * `label` is already the one the built-in widgets show ("Direct", a country's name).
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
			<WidgetCard title={TITLE}>
				<WidgetEmpty>{EMPTY}</WidgetEmpty>
			</WidgetCard>
		)
	}
	return (
		<WidgetCard caption="Last 30 days" title={TITLE}>
			<WidgetBody>
				<BarList
					data={result.rows.map((r) => ({
						label: r.label,
						value: r.value,
						display: formatMetricValue('pageviews', r.value, locale),
					}))}
					emptyLabel={EMPTY}
				/>
			</WidgetBody>
		</WidgetCard>
	)
}
