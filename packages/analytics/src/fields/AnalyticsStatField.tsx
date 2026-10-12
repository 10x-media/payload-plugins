import type { LabelFunction, PayloadRequest } from 'payload'
import { Suspense } from 'react'
import { type ReportOption, reportModes } from '../binding/report'
import type { BindingDoc } from '../binding/types'
import { OVER_BUDGET, withinBudget } from '../core/budget'
import { currentDate } from '../core/clock'
import type { MetricKey } from '../core/contract'
import { readingOf } from '../core/metricValues'
import { getRuntime, requestCurrency } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { intlLocale } from '../translations/intl'
import { keys } from '../translations/keys'
import { type FallbackLanguage, pickLabel } from '../translations/labelMap'
import { METRIC_KEYS, metricLabelKey, TIMEFRAME_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { MetricCard } from '../ui/components/MetricCard'
import { ReadState } from '../ui/components/ReadState'
import { WithScopeToken } from '../ui/data/WithScopeToken'
import { retryOfferFor } from '../ui/readState'
import { widgetNotice } from '../widgets/notices'
import { AnalyticsEmptyState, createdAtOf, isNewDocumentAnalytics } from './emptyState'
import { FieldShimmer } from './FieldShimmer'
import type { AnalyticsMetricLabel, AnalyticsMetricLabels } from './factories'
import { formatMetricValue } from './format'
import { ITEM_STAT_METRICS, itemMetricLabel } from './itemReport'
import { readForField } from './readForDocument'
import { FIELD_STATE_KEYS } from './stateKeys'
import '../ui/analytics.css'

/** @internal */
export type StatFieldI18n = { t: unknown; language?: string; fallbackLanguage?: FallbackLanguage }

/** @internal */
export interface AnalyticsStatFieldProps {
	req: PayloadRequest
	data: BindingDoc
	collectionSlug: string
	i18n: StatFieldI18n
	metrics: MetricKey[]
	/** The metrics are the row's defaults, so an item report swaps in its own. */
	defaultMetrics?: boolean
	timeframe: TimeframePreset
	variant: 'stat' | 'row'
	adapterId?: string
	labels?: AnalyticsMetricLabels
	/** What the numbers are about; `auto` follows the binding, the item first. */
	report?: ReportOption
	/** Milliseconds the read may take before the field says it is still loading; default 2000. */
	budgetMs?: number
}

/** How long a stat waits on its read before it shows a loading note and lets the page finish. */
const STAT_READ_BUDGET_MS = 2000

/**
 * A card label the developer set (string, locale map or label function) as plain text; `fallback`
 * names the card when there is none, or a map has no entry for the reader's language.
 */
export const resolveMetricLabel = (
	override: AnalyticsMetricLabel | undefined,
	i18n: StatFieldI18n,
	fallback: () => string
): string => {
	if (typeof override === 'function') {
		// Payload hands a server field its full `I18nClient`; the prop type names only what is read here.
		return override({ i18n, t: i18n.t } as Parameters<LabelFunction>[0])
	}
	if (typeof override === 'string') return override
	if (override) {
		return pickLabel(override, i18n.language, i18n.fallbackLanguage) ?? fallback()
	}
	return fallback()
}

/**
 * Read-only per-document stat (or row), behind its own Suspense boundary. A read still pending
 * after {@link STAT_READ_BUDGET_MS} shows a loading note and finishes in the background.
 *
 * @internal
 */
export const AnalyticsStatField = (props: AnalyticsStatFieldProps) => (
	<Suspense fallback={<FieldShimmer height="3.5rem" />}>
		<WithScopeToken req={props.req}>
			<StatFieldBody {...props} />
		</WithScopeToken>
	</Suspense>
)

const StatFieldBody = async (props: AnalyticsStatFieldProps) => {
	const { req, data, collectionSlug, i18n, timeframe, adapterId, labels } = props
	const t = asTranslate(i18n.t)
	const locale = intlLocale(i18n.language)
	const runtime = getRuntime(req.payload)
	const binding = runtime?.bindings[collectionSlug]
	const report = reportModes(binding, props.report ?? 'auto')[0] ?? 'page'
	const metrics = report === 'item' && props.defaultMetrics ? ITEM_STAT_METRICS : props.metrics

	const now = currentDate()
	const reading = Promise.all([
		requestCurrency(req),
		readForField({ req, collectionSlug, data, metrics, timeframe, adapterId, now, report }),
	])
	const answered = await withinBudget(reading, props.budgetMs ?? STAT_READ_BUDGET_MS)
	if (answered === OVER_BUDGET) {
		// Finished past the response, so the next load finds the answer cached.
		runtime?.engine.keep?.(reading)
		return (
			<div className="field-type analytics-stat--loading analytics-stat--muted">
				<AnalyticsEmptyState isNew={false}>{t(keys.stateRefreshing)}</AnalyticsEmptyState>
			</div>
		)
	}
	const [reporting, result] = answered

	if (isNewDocumentAnalytics(result, createdAtOf(data))) {
		return (
			<div className="field-type">
				<AnalyticsEmptyState isNew>{t(keys.stateNew)}</AnalyticsEmptyState>
			</div>
		)
	}
	if (result.status !== 'ok') {
		return (
			<div className="field-type analytics-stat--muted">
				<AnalyticsEmptyState isNew={false}>
					<ReadState
						align="start"
						message={t(FIELD_STATE_KEYS[result.status])}
						retry={retryOfferFor(result.status, result.retryAfterMs, { t, locale })}
					/>
				</AnalyticsEmptyState>
			</div>
		)
	}

	const notice = widgetNotice(result.notices ?? {}, { t, locale, now, timeZone: result.timezone })
	const currency = result.notices?.currency ?? reporting
	return (
		<div className="field-type analytics-stat">
			{result.supportedMetrics.map((metric) => (
				<MetricCard
					className="analytics-stat__card"
					key={metric}
					label={resolveMetricLabel(labels?.[metric], i18n, () =>
						t(
							report === 'item'
								? itemMetricLabel(metric, METRIC_KEYS[metric])
								: metricLabelKey(metric, result.notices?.visitorsSummed)
						)
					)}
					noValueLabel={t(keys.stateNoValue)}
					value={formatMetricValue(metric, readingOf(result.metrics, metric), {
						locale,
						currency,
					})}
				/>
			))}
			<span className="analytics-stat__caption">{t(TIMEFRAME_KEYS[timeframe])}</span>
			{notice === '' ? null : <span className="analytics-stat__caption">{notice}</span>}
		</div>
	)
}
