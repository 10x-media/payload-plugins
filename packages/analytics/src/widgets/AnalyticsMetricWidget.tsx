import { currentDate } from '../core/clock'
import { formatMetricValue } from '../fields/format'
import { revenueCurrencyOf } from '../goals/currency'
import { requestCurrency } from '../plugin/runtime'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { ComparisonDelta } from './ComparisonDelta'
import { widgetFilters } from './filterField'
import { widgetNotice } from './notices'
import { readForWidget } from './readForWidget'
import { metricWidgetTitle, placeholderTitle } from './titleForecast'
import type { MetricWidgetData } from './types'
import { type AnalyticsWidgetProps, widgetLink } from './viewLink'
import { WidgetCard, WidgetNote, WidgetValue } from './WidgetCard'
import { WidgetFrame, WidgetStateCard } from './WidgetFrame'
import { storedWidgetData } from './widgetData'
import { resolveWidgetWindow, widgetCaption, windowReadArgs } from './widgetWindow'

const CLASS_NAME = 'analytics-metric-widget'

const dataOf = (props: AnalyticsWidgetProps): MetricWidgetData => storedWidgetData(props.widgetData)

/**
 * The card's frame paints at once; its number streams in when the read answers.
 *
 * @beta
 */
export default function AnalyticsMetricWidget(props: AnalyticsWidgetProps) {
	return (
		<WidgetFrame
			className={CLASS_NAME}
			kind="metric"
			widget={props}
			{...placeholderTitle(props.req, dataOf(props), { series: false })}
		>
			<MetricWidgetBody {...props} />
		</WidgetFrame>
	)
}

async function MetricWidgetBody(props: AnalyticsWidgetProps) {
	const data = dataOf(props)
	const metric = data.metric ?? 'pageviews'
	const t = asTranslate(props.req.i18n.t)
	const locale = intlLocale(props.req.i18n.language)
	const window = await resolveWidgetWindow(props.req, data)
	if (window.unreadable) {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				locale={locale}
				status="invalid"
				t={t}
				title={metricWidgetTitle(data, t)}
			/>
		)
	}
	const reporting = await requestCurrency(props.req)
	const filters = widgetFilters(data)
	const now = currentDate()
	const result = await readForWidget({
		req: props.req,
		metrics: [metric],
		adapterId: data.dataSource,
		fallbackWhenUnreadable: true,
		now,
		filters,
		...windowReadArgs(window),
	})
	const link = widgetLink(props, t, { window, adapterId: result.adapterId, metric, filters })
	if (result.status !== 'ok') {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				link={link}
				locale={locale}
				retryAfterMs={result.retryAfterMs}
				status={result.status}
				t={t}
				title={metricWidgetTitle(data, t)}
			/>
		)
	}

	const caption = await widgetCaption(props.req, { window, filters, read: result, locale, t })
	const value = result.metrics[metric]
	const currency = result.currency ?? revenueCurrencyOf(filters, reporting)
	return (
		<WidgetCard
			className={CLASS_NAME}
			caption={caption}
			link={link}
			title={metricWidgetTitle(data, t, result.visitorsSummed)}
		>
			<WidgetValue
				noValueLabel={t(keys.stateNoValue)}
				value={formatMetricValue(metric, value, { locale, currency })}
			>
				{result.comparisonRange ? (
					<ComparisonDelta
						current={value}
						previous={result.previousMetrics?.[metric]}
						metric={metric}
						locale={locale}
						t={t}
					/>
				) : null}
			</WidgetValue>
			<WidgetNote>{widgetNotice(result, { t, locale, now, timeZone: result.timezone })}</WidgetNote>
		</WidgetCard>
	)
}
