import type { PayloadRequest } from 'payload'
import { Suspense } from 'react'
import { type ReportOption, reportModes } from '../binding/report'
import type { BindingDoc } from '../binding/types'
import { currentDate } from '../core/clock'
import type { DateRange, DimensionKey, MetricKey } from '../core/contract'
import { type DocumentScope, resolveDocumentScope } from '../plugin/documentScopes'
import { type RequestSource, resolveSourcesForRequest } from '../plugin/readContextForRequest'
import { getRuntime, requestCurrency } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
import { asTranslate } from '../translations/server'
import { WithScopeToken } from '../ui/data/WithScopeToken'
import type { CountryFlags } from '../view/CountryFlag'
import { hostCountryFlag } from '../view/hostCountryFlag'
import { AnalyticsPanelClient, type PanelData, type PanelSeed } from './AnalyticsPanelClient'
import { resolveMetricLabel, type StatFieldI18n } from './AnalyticsStatField'
import { createdAtOf } from './emptyState'
import { FieldShimmer } from './FieldShimmer'
import type { AnalyticsMetricLabels } from './factories'
import {
	ITEM_PANEL_DIMENSIONS,
	ITEM_PANEL_METRICS,
	ITEM_PANEL_OPTIONAL_METRICS,
} from './itemReport'
import { type FieldPeek, type FieldReadResult, peekForField } from './readForDocument'

/** @internal */
export interface AnalyticsPanelFieldProps {
	req: PayloadRequest
	data: BindingDoc
	collectionSlug: string
	i18n: StatFieldI18n
	metrics: MetricKey[]
	/** Metrics the factory added speculatively; a source serving none of them warns nobody. */
	optionalMetrics?: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	labels?: AnalyticsMetricLabels
	/** Dimensions ranked for this page, empty when the factory turned the breakdowns off. */
	dimensions?: DimensionKey[]
	/** Draw the live counter where the source counts live visitors. */
	liveVisitors?: boolean
	/** Sources the switcher offers: `'auto'` is the document scope's own, a list narrows it. */
	sources?: 'auto' | string[]
	/** What the panel reports on; `auto` follows the binding, the item first. */
	report?: ReportOption
}

/**
 * Server entry for the document panel. Payload renders every field as a document loads (hidden
 * tabs too), so this never waits on a source: the seed is a budgeted {@link peekForField}.
 *
 * @internal
 */
export const AnalyticsPanelField = (props: AnalyticsPanelFieldProps) => (
	<Suspense fallback={<FieldShimmer height="15rem" />}>
		<WithScopeToken req={props.req}>
			<PanelFieldBody {...props} />
		</WithScopeToken>
	</Suspense>
)

const isoRange = (range: DateRange): { start: string; end: string } => ({
	start: range.start.toISOString(),
	end: range.end.toISOString(),
})

/** The panel's first answer as the client takes it, dates as ISO strings. */
const toPanelData = (result: FieldReadResult): PanelData => ({
	status: result.status,
	...(result.report === undefined ? {} : { report: result.report }),
	metrics: result.metrics,
	supportedMetrics: result.supportedMetrics,
	previousMetrics: result.previousMetrics,
	timezone: result.timezone,
	dateRange: isoRange(result.dateRange),
	comparisonRange: result.comparisonRange ? isoRange(result.comparisonRange) : undefined,
	points: result.points,
	seriesGranularity: result.seriesGranularity,
	realtime: result.realtime,
	breakdowns: result.breakdowns,
	notices: result.notices,
})

/**
 * Without the totals there is nothing worth showing first; with them, a list nobody has read yet
 * is filled in by the client's read like a stale answer is.
 */
const seedOf = ({ complete, stale, result }: FieldPeek): PanelSeed => {
	if (complete && !stale) {
		return 'fresh'
	}
	return result.status === 'ok' ? 'stale' : 'missing'
}

/**
 * Only the card labels the developer set, as plain strings: the panel names every other card
 * itself, once its read says how the numbers were counted.
 */
const labelOverrides = (
	labels: AnalyticsMetricLabels | undefined,
	metrics: MetricKey[],
	i18n: StatFieldI18n
): Partial<Record<MetricKey, string>> => {
	const t = asTranslate(i18n.t)
	const resolved: Partial<Record<MetricKey, string>> = {}
	for (const metric of metrics) {
		const override = labels?.[metric]
		if (override !== undefined) {
			resolved[metric] = resolveMetricLabel(override, i18n, () => t(METRIC_KEYS[metric]))
		}
	}
	return resolved
}

const PanelFieldBody = async (props: AnalyticsPanelFieldProps) => {
	const { req, data, collectionSlug, i18n, metrics, timeframe, adapterId, labels } = props
	const dimensions = props.dimensions ?? []
	const renderedAt = currentDate()
	const currency = await requestCurrency(req)
	const runtime = getRuntime(req.payload)
	const flags = runtime?.countryFlags ?? true
	// The host's flag is looked up once here, for the client rows to render.
	const countryFlags: CountryFlags =
		typeof flags === 'object'
			? (hostCountryFlag(flags, req.payload.importMap, (message) =>
					req.payload.logger.warn(message)
				) ?? false)
			: flags
	const modes = reportModes(runtime?.bindings[collectionSlug], props.report ?? 'auto')
	const report = modes[0] ?? 'page'
	const item = report === 'item'
	const readOptional = item ? ITEM_PANEL_OPTIONAL_METRICS : props.optionalMetrics
	// The switcher lists the document scope's own sources, so that scope is gated first: a refusal
	// lists none, and the read says no-access.
	const documentScope: DocumentScope = runtime
		? await resolveDocumentScope({ runtime, req, collection: collectionSlug, data })
		: { ok: true, scope: null }
	const listSources = async (): Promise<RequestSource[]> => {
		if (!documentScope.ok) {
			return []
		}
		const listing = await resolveSourcesForRequest(
			req,
			documentScope.scope === null ? {} : { scope: documentScope.gated }
		)
		return listing.sources
	}
	const [peeked, sources] = await Promise.all([
		peekForField({
			req,
			collectionSlug,
			data,
			metrics: item ? ITEM_PANEL_METRICS : metrics,
			...(readOptional ? { optionalMetrics: readOptional } : {}),
			timeframe,
			adapterId,
			...(dimensions.length > 0 ? { dimensions: item ? ITEM_PANEL_DIMENSIONS : dimensions } : {}),
			now: renderedAt,
			compare: true,
			series: true,
			report,
		}),
		listSources(),
	])
	const offered = sources
		.filter(
			(source) =>
				props.sources === undefined || props.sources === 'auto' || props.sources.includes(source.id)
		)
		.map((source) => ({
			id: source.id,
			label: source.label,
			perItemQuery: source.capabilities.perItemQuery === true,
		}))

	const result = peeked.result
	const createdAt = createdAtOf(data)
	const seed = seedOf(peeked)

	return (
		<AnalyticsPanelClient
			collectionSlug={collectionSlug}
			countryFlags={countryFlags}
			dimensions={dimensions}
			liveVisitors={props.liveVisitors !== false}
			metrics={metrics}
			sources={offered}
			initialSourceId={adapterId ?? result.adapterId}
			{...(props.optionalMetrics ? { optionalMetrics: props.optionalMetrics } : {})}
			{...(seed === 'missing' ? {} : { initial: toPanelData(result) })}
			renderedAt={renderedAt.toISOString()}
			seed={seed}
			initialReport={report}
			initialTimeframe={timeframe}
			adapterId={adapterId}
			itemLabelOverrides={labelOverrides(labels, ITEM_PANEL_METRICS, i18n)}
			labels={labelOverrides(labels, metrics, i18n)}
			modes={modes}
			{...(currency ? { currency } : {})}
			{...(createdAt === undefined ? {} : { createdAt })}
		/>
	)
}
