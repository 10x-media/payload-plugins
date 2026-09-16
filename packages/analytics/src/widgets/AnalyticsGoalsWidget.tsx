import type { WidgetServerProps } from 'payload'
import type { CSSProperties } from 'react'
import { formatMetricValue } from '../fields/format'
import { requestTimezone } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { keys, type TranslationKey } from '../translations/keys'
import { METRIC_KEYS, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { ComparisonDelta } from './ComparisonDelta'
import { cardStyle, labelStyle } from './cardChrome'
import { formatRangeCaption, resolveCustomRange } from './range'
import type { WidgetReadStatus } from './readForWidget'
import { readForWidgetGoals } from './readForWidgetGoals'
import { type GoalsWidgetData, resolveGoalRowLimit } from './types'
import { type WidgetViewProps, widgetViewHref } from './viewLink'
import { WidgetViewLink } from './WidgetViewLink'

// The goals widget carries no filter, so `filter-unsupported` is unreachable here; the map
// stays total so the status union cannot grow without every widget answering for it.
const STATE_KEY: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
	'filter-unsupported': keys.stateFilterUnsupported,
}

const tableStyle: CSSProperties = {
	width: '100%',
	borderCollapse: 'collapse',
	fontSize: '0.8125rem',
	color: 'var(--theme-elevation-800)',
}

const headStyle: CSSProperties = {
	...labelStyle,
	textAlign: 'left',
	padding: '0 0 0.25rem',
	borderBottom: '1px solid var(--theme-elevation-150)',
}

const cellStyle: CSSProperties = {
	padding: '0.375rem 0',
	borderBottom: '1px solid var(--theme-elevation-100)',
	textAlign: 'left',
}

const numericStyle: CSSProperties = { ...cellStyle, textAlign: 'right' }
const numericHeadStyle: CSSProperties = { ...headStyle, textAlign: 'right' }
/** Stands in for a cell the source served no number for, in a column other rows fill. */
const MISSING = '-'

const captionStyle: CSSProperties = { fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }
const noteStyle: CSSProperties = { fontSize: '0.6875rem', color: 'var(--theme-elevation-400)' }

/**
 * Conversions per goal over the widget's window, with the period-over-period delta, the
 * share of the site's visitors each goal converted, and revenue as a bare number: a goal's
 * currency is its own, so one formatted column would state a currency the rows do not
 * share. Columns the source cannot fill are left out rather than rendered empty.
 */
export default async function AnalyticsGoalsWidget(props: WidgetServerProps & WidgetViewProps) {
	const t = asTranslate(props.req.i18n.t)
	const data = (props.widgetData ?? {}) as GoalsWidgetData
	const rawTimeframe = data.timeframe ?? 'last30days'
	// Only a custom range needs the reporting timezone before the read; a preset window
	// resolves inside the read path, which resolves the timezone there as it always has.
	const timezone = rawTimeframe === 'custom' ? await requestTimezone(props.req) : undefined
	const customRange = timezone ? resolveCustomRange(rawTimeframe, data.range, timezone) : undefined
	const timeframe: TimeframePreset = rawTimeframe === 'custom' ? 'last30days' : rawTimeframe
	const title = data.title?.trim() || t(keys.widgetGoals)
	const compare = data.compare === true
	const result = await readForWidgetGoals({
		req: props.req,
		timeframe,
		limit: resolveGoalRowLimit(data.limit),
		compare,
		adapterId: data.dataSource,
		now: new Date(),
		range: customRange,
		...(timezone ? { timezone } : {}),
	})
	// The adapter that answered, which on a scoped or runtime-provider install is not the
	// id the widget asked for. The metric rides along because the view's goals tab ranks by
	// it: without it the tab opens ranked by the view's default rather than by conversions.
	const href = widgetViewHref(props.view, props.req, {
		timeframe: rawTimeframe,
		timezone: timezone ?? DEFAULT_TIMEZONE,
		...(customRange ? { range: customRange } : {}),
		...(result.adapterId ? { source: result.adapterId } : {}),
		metric: 'conversions',
		compare,
		tab: 'goals',
	})

	const locale = props.req.i18n.language ?? 'en-US'
	const caption =
		customRange && timezone
			? formatRangeCaption(customRange, locale, timezone)
			: t(TIMEFRAME_KEYS[timeframe])
	const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
	const showsRate = result.rows.some((row) => row.rate !== undefined)
	const showsRevenue = result.rows.some((row) => row.revenue !== undefined)

	return (
		<div className="analytics-goals-widget" style={cardStyle}>
			<span style={labelStyle}>{title}</span>
			{result.status !== 'ok' ? (
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(STATE_KEY[result.status])}</span>
			) : result.goalsUnresolved ? (
				// The source never answered about the goals, which the plain empty state would
				// read as "nobody converted".
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(keys.stateGoalsUnresolved)}</span>
			) : result.rows.length === 0 ? (
				<span style={{ color: 'var(--theme-elevation-400)' }}>{t(keys.stateNoBreakdown)}</span>
			) : (
				<table style={tableStyle}>
					<thead>
						<tr>
							<th scope="col" style={headStyle}>
								{t(keys.fieldGoalLabel)}
							</th>
							<th scope="col" style={numericHeadStyle}>
								{t(METRIC_KEYS.conversions)}
							</th>
							{showsRevenue ? (
								<th scope="col" style={numericHeadStyle}>
									{t(METRIC_KEYS.revenue)}
								</th>
							) : null}
							{showsRate ? (
								<th scope="col" style={numericHeadStyle}>
									{t(keys.viewConversionRate)}
								</th>
							) : null}
						</tr>
					</thead>
					<tbody>
						{result.rows.map((row) => (
							<tr key={row.slug}>
								<td style={cellStyle}>{row.name}</td>
								<td style={numericStyle}>
									<span
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											gap: '0.5rem',
											justifyContent: 'flex-end',
										}}
									>
										{formatMetricValue('conversions', row.conversions, locale)}
										<ComparisonDelta
											current={row.conversions}
											previous={row.previousConversions}
											metric="conversions"
											locale={locale}
											t={t}
										/>
									</span>
								</td>
								{showsRevenue ? (
									<td style={numericStyle}>
										{row.revenue === undefined
											? MISSING
											: formatMetricValue('revenue', row.revenue, locale)}
									</td>
								) : null}
								{showsRate ? (
									<td style={numericStyle}>
										{row.rate === undefined ? MISSING : percent.format(row.rate)}
									</td>
								) : null}
							</tr>
						))}
					</tbody>
				</table>
			)}
			<span style={captionStyle}>{caption}</span>
			{result.stale ? <span style={noteStyle}>{t(keys.viewStale)}</span> : null}
			{result.clamped ? <span style={noteStyle}>{t(keys.stateClamped)}</span> : null}
			<WidgetViewLink href={href} label={t(keys.widgetOpenInView)} />
		</div>
	)
}
