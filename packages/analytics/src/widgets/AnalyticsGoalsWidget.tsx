import { currentDate } from '../core/clock'
import { formatMetricValue, formatRate } from '../fields/format'
import { requestCurrency } from '../plugin/runtime'
import { computeDelta } from '../timeframe/comparison'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate, type Translate } from '../translations/server'
import { DataTable } from '../ui/components/DataTable'
import { ComparisonDelta } from './ComparisonDelta'
import { widgetNotice } from './notices'
import { readForWidgetGoals } from './readForWidgetGoals'
import { emptyGoalsKey } from './stateKeys'
import { type GoalsWidgetData, resolveGoalRowLimit } from './types'
import { type AnalyticsWidgetProps, widgetLink } from './viewLink'
import { WidgetBody, WidgetCard, WidgetEmpty, WidgetNote } from './WidgetCard'
import { WidgetFrame, WidgetStateCard } from './WidgetFrame'
import { storedWidgetData } from './widgetData'
import { resolveWidgetWindow, windowCaption, windowReadArgs } from './widgetWindow'

const CLASS_NAME = 'analytics-goals-widget'

/** A scope configures a handful of goals far more often than its row limit's worth. */
const SHIMMER_ROWS = 5

const dataOf = (props: AnalyticsWidgetProps): GoalsWidgetData => storedWidgetData(props.widgetData)

const titleOf = (data: GoalsWidgetData, t: Translate): string =>
	data.title?.trim() || t(keys.widgetGoals)

/**
 * Conversions per goal over the widget's window, with delta, conversion rate and revenue.
 * Columns the source cannot fill are left out rather than rendered empty.
 *
 * @beta
 */
export default function AnalyticsGoalsWidget(props: AnalyticsWidgetProps) {
	const t = asTranslate(props.req.i18n.t)
	return (
		<WidgetFrame
			className={CLASS_NAME}
			kind="goals"
			rows={SHIMMER_ROWS}
			title={titleOf(dataOf(props), t)}
			widget={props}
		>
			<GoalsWidgetBody {...props} />
		</WidgetFrame>
	)
}

async function GoalsWidgetBody(props: AnalyticsWidgetProps) {
	const t = asTranslate(props.req.i18n.t)
	const locale = intlLocale(props.req.i18n.language)
	const data = dataOf(props)
	const title = titleOf(data, t)
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
	const compare = data.compare === true
	const now = currentDate()
	const result = await readForWidgetGoals({
		req: props.req,
		limit: resolveGoalRowLimit(data.limit),
		compare,
		adapterId: data.dataSource,
		now,
		...windowReadArgs(window),
	})
	// The metric rides along so the view's goals tab opens ranked by conversions, not its default.
	const link = widgetLink(props, t, {
		window,
		adapterId: result.adapterId,
		metric: 'conversions',
		compare,
		tab: 'goals',
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

	// The goal-resolution states are the table's own empty states here, so the line below it
	// carries only what the read says about its numbers.
	const notice = widgetNotice(
		{ ...result, goalsUnresolved: false, noGoals: false },
		{ t, locale, now, timeZone: result.timezone }
	)
	const showsRate = result.rows.some((row) => row.rate !== undefined)
	const showsRevenue = result.rows.some((row) => row.revenue !== undefined)
	const showsDelta = result.rows.some(
		(row) => computeDelta(row.conversions, row.previousConversions) !== null
	)
	const currency = result.currency ?? reporting
	return (
		<WidgetCard
			className={CLASS_NAME}
			caption={windowCaption(window, locale, t)}
			link={link}
			title={title}
		>
			{/* Rows counted against goals the source could not resolve mean nothing, so none show. */}
			{result.goalsUnresolved || result.rows.length === 0 ? (
				<WidgetEmpty>{t(emptyGoalsKey(result))}</WidgetEmpty>
			) : (
				<WidgetBody>
					<DataTable
						className="analytics-goals-widget__table"
						columns={[
							{ key: 'conversions', header: t(METRIC_KEYS.conversions) },
							...(showsRevenue ? [{ key: 'revenue', header: t(METRIC_KEYS.revenue) }] : []),
							...(showsRate ? [{ key: 'rate', header: t(keys.viewConversionRate) }] : []),
						]}
						label={title}
						labelHeader={t(keys.fieldGoalLabel)}
						noValueLabel={t(keys.stateNoValue)}
						rows={result.rows.map((row) => ({
							key: row.slug,
							label: row.name,
							cells: [
								<span className="analytics-table__value" key="conversions">
									{formatMetricValue('conversions', row.conversions, locale)}
									<ComparisonDelta
										caption={false}
										current={row.conversions}
										previous={row.previousConversions}
										metric="conversions"
										locale={locale}
										t={t}
									/>
								</span>,
								...(showsRevenue
									? [formatMetricValue('revenue', row.revenue, { locale, currency })]
									: []),
								...(showsRate ? [formatRate(row.rate, locale)] : []),
							],
						}))}
					/>
					{showsDelta ? (
						<span className="analytics-delta__caption">{t(keys.comparisonVsPrevious)}</span>
					) : null}
				</WidgetBody>
			)}
			<WidgetNote>{notice}</WidgetNote>
		</WidgetCard>
	)
}
