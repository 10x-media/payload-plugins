import type { ReactNode } from 'react'
import { barShares } from '../charts/bars'
import { currentDate } from '../core/clock'
import type { MetricKey } from '../core/contract'
import { readingOf } from '../core/metricValues'
import { formatMetricValue } from '../fields/format'
import { requestCurrency } from '../plugin/runtime'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { metricLabelKey } from '../translations/metricKeys'
import { asTranslate, type Translate } from '../translations/server'
import { DataTable } from '../ui/components/DataTable'
import { toDisplayRows } from '../ui/rows/toDisplayRows'
import { CountryFlagImg } from '../view/CountryFlag'
import { countryFlagSrc, countryFlagsMount } from '../view/flagSrc'
import { renderRowFlag } from '../view/hostCountryFlag'
import { DIMENSION_LABELS } from '../view/labels'
import { type BreakdownSpec, type BreakdownWidgetData, breakdownSpecBySlug } from './breakdownTypes'
import { widgetFilters } from './filterField'
import { widgetNotice } from './notices'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'
import { emptyGoalsKey } from './stateKeys'
import { type AnalyticsWidgetProps, viewTabForDimension, widgetLink } from './viewLink'
import { WidgetBody, WidgetCard, WidgetEmpty, WidgetNote } from './WidgetCard'
import { WidgetFrame, WidgetStateCard } from './WidgetFrame'
import { storedWidgetData } from './widgetData'
import { resolveWidgetWindow, widgetCaption, windowReadArgs } from './widgetWindow'

const CLASS_NAME = 'analytics-breakdown-widget'

const DEFAULT_LIMIT = 5

/** A list fills its row limit more often than not; past this many rows the guess stops paying. */
const MAX_SHIMMER_ROWS = 10

const dataOf = (props: AnalyticsWidgetProps): BreakdownWidgetData => {
	const { limit, ...stored } = storedWidgetData(props.widgetData)
	return { ...stored, ...(typeof limit === 'number' ? { limit } : {}) }
}

const titleOf = (
	data: BreakdownWidgetData,
	spec: BreakdownSpec | undefined,
	t: Translate
): string => data.title?.trim() || (spec ? t(spec.label) : '')

const shimmerRows = (limit: number | undefined): number =>
	Math.min(
		Math.max(Math.round(Number(limit ?? DEFAULT_LIMIT)) || DEFAULT_LIMIT, 1),
		MAX_SHIMMER_ROWS
	)

/**
 * The card's frame paints at once; its list streams in when the read answers.
 *
 * @beta
 */
export default function AnalyticsBreakdownWidget(props: AnalyticsWidgetProps) {
	const t = asTranslate(props.req.i18n.t)
	const data = dataOf(props)
	return (
		<WidgetFrame
			className={CLASS_NAME}
			kind="breakdown"
			rows={shimmerRows(data.limit)}
			title={titleOf(data, breakdownSpecBySlug(props.widgetSlug), t)}
			widget={props}
		>
			<BreakdownWidgetBody {...props} />
		</WidgetFrame>
	)
}

async function BreakdownWidgetBody(props: AnalyticsWidgetProps) {
	const spec = breakdownSpecBySlug(props.widgetSlug)
	const t = asTranslate(props.req.i18n.t)
	const locale = intlLocale(props.req.i18n.language)
	const data = dataOf(props)
	const title = titleOf(data, spec, t)
	if (!spec) {
		return (
			<WidgetCard className={CLASS_NAME} title={title}>
				<WidgetEmpty>{t(keys.stateUnavailable)}</WidgetEmpty>
			</WidgetCard>
		)
	}
	// The spec's own default, not pageviews: an events or goals widget saved before its
	// picker had a default would otherwise rank by a metric its dimension cannot answer.
	const metric: MetricKey = data.metric ?? spec.preferredDefault ?? 'pageviews'
	const window = await resolveWidgetWindow(props.req, data)
	if (window.unreadable) {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				locale={locale}
				status="invalid"
				t={t}
				title={title}
			/>
		)
	}
	const reporting = await requestCurrency(props.req)
	const tab = viewTabForDimension(spec.dimension)
	const filters = widgetFilters(data)
	const now = currentDate()
	const result = await readForWidgetBreakdown({
		req: props.req,
		metric,
		dimension: spec.dimension,
		limit: data.limit ?? DEFAULT_LIMIT,
		adapterId: data.dataSource,
		fallbackWhenUnreadable: true,
		now,
		filters,
		...windowReadArgs(window),
	})
	const link = widgetLink(props, t, {
		window,
		adapterId: result.adapterId,
		...(tab ? { tab, dim: spec.dimension } : {}),
		metric,
		filters,
	})
	if (result.status !== 'ok') {
		return (
			<WidgetStateCard
				className={CLASS_NAME}
				link={link}
				locale={locale}
				retryAfterMs={result.retryAfterMs}
				status={result.status}
				t={t}
				title={title}
			/>
		)
	}

	// Built here rather than in the row map: the same config reads answer every row.
	const flagsMount = countryFlagsMount(props.req.payload.config)
	const flags = props.countryFlags ?? true
	const flagFor = (code: string): ReactNode =>
		typeof flags === 'object' ? (
			renderRowFlag(flags, props.req.payload.importMap, code)
		) : (
			<CountryFlagImg src={countryFlagSrc(flagsMount, code)} />
		)
	const currency = result.currency ?? reporting
	const caption = await widgetCaption(props.req, { window, filters, read: result, locale, t })
	// The goal-resolution states are the list's own empty label here, so the line below it
	// carries only what the read says about its numbers.
	const notice = widgetNotice(
		{ ...result, goalsUnresolved: false, noGoals: false },
		{ t, locale, now, timeZone: result.timezone }
	)
	const displayed = toDisplayRows(
		result.rows.map((row) => ({ value: row.dimensionValue, metrics: { [metric]: row.value } })),
		{
			dimension: spec.dimension,
			provider: result.provider ?? '',
			t,
			locale,
			...(result.goals ? { goals: result.goals } : {}),
			countryFlags: flags !== false,
		}
	)
	const values = displayed.map((row) => readingOf(row.metrics, metric))
	const shares = barShares(values)
	return (
		<WidgetCard className={CLASS_NAME} caption={caption} link={link} title={title}>
			{displayed.length === 0 ? (
				<WidgetEmpty>
					{t(spec.dimension === 'goal' ? emptyGoalsKey(result) : keys.stateNoBreakdown)}
				</WidgetEmpty>
			) : (
				<WidgetBody>
					<DataTable
						bars="soft"
						columns={[
							{
								key: metric,
								header: t(metricLabelKey(metric, result.visitorsSummed)),
								className: 'analytics-bars__value',
							},
						]}
						head="hidden"
						label={title}
						labelHeader={t(DIMENSION_LABELS[spec.dimension])}
						noValueLabel={t(keys.stateNoValue)}
						rows={displayed.map((row, i) => ({
							key: row.key,
							label: row.label,
							bar: shares[i] ?? 0,
							...(row.flag === null ? {} : { decoration: flagFor(row.flag) }),
							cells: [formatMetricValue(metric, values[i] ?? null, { locale, currency })],
						}))}
					/>
				</WidgetBody>
			)}
			<WidgetNote>{notice}</WidgetNote>
		</WidgetCard>
	)
}
