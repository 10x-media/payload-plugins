import type { WidgetServerProps } from 'payload'
import { BarList } from '../charts/BarList'
import type { MetricKey } from '../core/contract'
import { formatMetricValue } from '../fields/format'
import { requestTimezone } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { keys, type TranslationKey } from '../translations/keys'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { valueLabel } from '../view/labels'
import { type BreakdownWidgetData, breakdownSpecBySlug } from './breakdownTypes'
import { cardStyle, labelStyle } from './cardChrome'
import { captionWithFilter } from './filterCaption'
import { widgetFilters } from './filterField'
import { formatRangeCaption, resolveCustomRange } from './range'
import type { WidgetReadStatus } from './readForWidget'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'
import { viewTabForDimension, type WidgetViewProps, widgetViewHref } from './viewLink'
import { WidgetViewLink } from './WidgetViewLink'

const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
	'filter-unsupported': keys.stateFilterUnsupported,
}

export default async function AnalyticsBreakdownWidget(props: WidgetServerProps & WidgetViewProps) {
	const spec = breakdownSpecBySlug(props.widgetSlug)
	const t = asTranslate(props.req.i18n.t)
	const data = (props.widgetData ?? {}) as BreakdownWidgetData
	const metric: MetricKey = data.metric ?? 'pageviews'
	const rawTimeframe = data.timeframe ?? 'last30days'
	// Only a custom range needs the reporting timezone before the read; a preset window
	// resolves inside the read path, which resolves the timezone there as it always has.
	const timezone = rawTimeframe === 'custom' ? await requestTimezone(props.req) : undefined
	const customRange = timezone ? resolveCustomRange(rawTimeframe, data.range, timezone) : undefined
	const timeframe: TimeframePreset = rawTimeframe === 'custom' ? 'last30days' : rawTimeframe
	const limit = data.limit ?? 5
	const title = data.title?.trim() || (spec ? t(spec.label) : '')

	if (!spec) {
		return (
			<div className="analytics-breakdown-widget" style={cardStyle}>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(keys.stateUnavailable)}</span>
			</div>
		)
	}

	const tab = viewTabForDimension(spec.dimension)
	const filters = widgetFilters(data)
	const result = await readForWidgetBreakdown({
		req: props.req,
		metric,
		dimension: spec.dimension,
		timeframe,
		limit,
		adapterId: data.dataSource,
		now: new Date(),
		range: customRange,
		filters,
		...(timezone ? { timezone } : {}),
	})
	// The adapter that answered, which on a scoped or runtime-provider install is not the
	// id the widget asked for.
	const href = widgetViewHref(props.view, props.req, {
		timeframe: rawTimeframe,
		timezone: timezone ?? DEFAULT_TIMEZONE,
		...(customRange ? { range: customRange } : {}),
		...(result.adapterId ? { source: result.adapterId } : {}),
		...(tab ? { tab, dim: spec.dimension } : {}),
		metric,
		filters,
	})

	const locale = props.req.i18n.language ?? 'en-US'

	if (result.status !== 'ok') {
		return (
			<div className="analytics-breakdown-widget" style={cardStyle}>
				<span style={labelStyle}>{title}</span>
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
				<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
			</div>
		)
	}

	const windowCaption =
		customRange && timezone
			? formatRangeCaption(customRange, locale, timezone)
			: t(TIMEFRAME_KEYS[timeframe])
	const caption = captionWithFilter(windowCaption, filters[0], t)
	return (
		<div className="analytics-breakdown-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			<BarList
				data={result.rows.map((row) => ({
					label: valueLabel({
						dimension: spec.dimension,
						value: row.label,
						provider: result.provider ?? '',
						t,
					}),
					value: row.value,
					display: formatMetricValue(metric, row.value, locale),
				}))}
				emptyLabel={t(
					// A goal read the source could not resolve has no rows, which the plain empty
					// state would read as "nobody converted".
					spec.dimension === 'goal' && result.goalsUnresolved
						? keys.stateGoalsUnresolved
						: keys.stateNoBreakdown
				)}
			/>
			<span style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>{caption}</span>
			{result.clamped ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{t(keys.stateClamped)}
				</span>
			) : null}
			{result.filtersUnapplied ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{t(keys.stateFiltersUnapplied)}
				</span>
			) : null}
			{result.sampled ? (
				<span style={{ fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }}>
					{t(keys.stateSampled)}
				</span>
			) : null}
			<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
		</div>
	)
}
