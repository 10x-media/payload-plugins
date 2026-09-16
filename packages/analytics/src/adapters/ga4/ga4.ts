import type { BetaAnalyticsDataClient, protos } from '@google-analytics/data'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DimensionKey,
	FilterOperator,
	MetricKey,
} from '../../core/contract'
import { DEFAULT_TIMEZONE, zonedCalendarDay } from '../../timeframe/tz'
import {
	type GoalKeyedRow,
	goalHint,
	goalsUnresolvedResult,
	mergeGoalRows,
	mergeGoalTotals,
	providerMetricKeys,
	readGoalPair,
	splitGoalMetrics,
} from '../goalRead'
import { dayIso } from '../series'

export interface Ga4Config {
	/** GA4 property id (numeric), e.g. '123456789'. */
	propertyId: string
	/** Service-account credentials. */
	credentials: { client_email: string; private_key: string }
	/** GCP project id; inferred from the credentials when omitted. */
	projectId?: string
	/** Maximum days of historical data. Defaults to 425 (GA4's rolling-window limit). Pass null to disable clamping. */
	maxLookbackDays?: number | null
}

const METRIC_MAP: Partial<Record<MetricKey, string>> = {
	pageviews: 'screenPageViews',
	visitors: 'totalUsers',
	visits: 'sessions',
	sessions: 'sessions',
	bounceRate: 'bounceRate',
	avgDuration: 'averageSessionDuration',
	events: 'eventCount',
	conversions: 'keyEvents',
	revenue: 'totalRevenue',
}

const DIMENSION_MAP: Partial<Record<DimensionKey, string>> = {
	page: 'pagePath',
	referrer: 'pageReferrer',
	source: 'sessionSource',
	medium: 'sessionMedium',
	campaign: 'sessionCampaignName',
	utmSource: 'sessionSource',
	utmMedium: 'sessionMedium',
	utmCampaign: 'sessionCampaignName',
	device: 'deviceCategory',
	browser: 'browser',
	os: 'operatingSystem',
	country: 'countryId',
	region: 'region',
	city: 'city',
	language: 'language',
	event: 'eventName',
	goal: 'eventName',
}

/**
 * Metrics GA4 answers only for a goal-restricted read. `keyEvents` counts events the
 * property itself marks as key events, so an event that is a goal here but not marked
 * there reports 0.
 */
const GOAL_METRICS: ReadonlySet<MetricKey> = new Set(['conversions'])

type StringMatchType = 'EXACT' | 'CONTAINS' | 'FULL_REGEXP'

/**
 * FULL_REGEXP is a full match, so a pattern has to cover the whole value (`/docs/.*`, not
 * `^/docs`). PARTIAL_REGEXP exists but is not the contract's `matches`.
 */
const MATCH_TYPE_MAP: Record<FilterOperator, StringMatchType> = {
	eq: 'EXACT',
	contains: 'CONTAINS',
	matches: 'FULL_REGEXP',
}

// caseSensitive is explicit on every string filter because the Data API defaults it to
// false: `contains` stays insensitive, matching the native source and Umami's ilike, while
// `eq` and `matches` compare literally.
const CASE_SENSITIVE: Record<StringMatchType, boolean> = {
	EXACT: true,
	CONTAINS: false,
	FULL_REGEXP: true,
}

const stringFilter = (
	fieldName: string,
	matchType: StringMatchType,
	value: string
): protos.google.analytics.data.v1beta.IFilterExpression => ({
	filter: {
		fieldName,
		stringFilter: { matchType, value, caseSensitive: CASE_SENSITIVE[matchType] },
	},
})

const ga4Metrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
const ga4Dimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)
// `goal` is a breakdown, not a filter: the read's own goal slugs own the eventName clause.
const ga4Filters: ReadonlySet<DimensionKey> = new Set(
	[...ga4Dimensions].filter((dimension) => dimension !== 'goal')
)

// GA4 returns bounceRate as a 0..1 ratio and averageSessionDuration in seconds; the
// contract uses a 0..100 percentage and milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number => {
	if (metric === 'avgDuration') {
		return Math.round(raw * 1000)
	}
	if (metric === 'bounceRate') {
		return Math.round(raw * 100)
	}
	return raw
}

export function ga4(config: Ga4Config): AnalyticsAdapter {
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 425

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: ga4Metrics,
		dimensions: ga4Dimensions,
		filters: ga4Filters,
		filterOperators: new Set(['eq', 'contains', 'matches']),
		batchPageReport: true,
		rateLimit: { maxConcurrent: 10, quotaModel: 'tokens', readsCountAsUsage: true },
		recommendedTtl: { realtime: 300, aggregate: 21600 },
	}

	let clientPromise: Promise<BetaAnalyticsDataClient> | undefined

	const getClient = (): Promise<BetaAnalyticsDataClient> => {
		if (!clientPromise) {
			clientPromise = (async () => {
				let mod: typeof import('@google-analytics/data')
				try {
					mod = await import('@google-analytics/data')
				} catch {
					throw new Error(
						'@10x-media/analytics: the GA4 adapter requires the optional peer dependency "@google-analytics/data". Install it with: pnpm add @google-analytics/data'
					)
				}
				return new mod.BetaAnalyticsDataClient({
					credentials: config.credentials,
					projectId: config.projectId,
				})
			})()
		}
		return clientPromise
	}

	return {
		id: 'ga4',
		label: 'Google Analytics 4',
		capabilities,
		isConfigured: () =>
			Boolean(
				config.propertyId && config.credentials?.client_email && config.credentials?.private_key
			),
		// The gRPC SDK's gax CallOptions has no AbortSignal field, so ctx.signal cannot be
		// forwarded; gax cancellation uses the call's own handle, not our signal.
		async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const goalBreakdown = dims.includes('goal')
			const hint = goalHint(q)
			if (goalBreakdown && !hint) {
				return goalsUnresolvedResult('ga4', q)
			}
			const wanted = q.metrics.filter((m) => METRIC_MAP[m])
			const { siteMetrics, goalMetrics, unresolved } = splitGoalMetrics({
				wanted,
				goalOnly: GOAL_METRICS,
				goalBreakdown,
				hint,
			})
			const siteKeys = providerMetricKeys(siteMetrics, METRIC_MAP)
			const goalKeys = providerMetricKeys(goalMetrics, METRIC_MAP)
			const providerDims = [...new Set(dims.map((d) => DIMENSION_MAP[d] as string))]
			// Set when GA4 rejects a goal report the site report survived, so the rows keep their
			// site metrics and lose only their conversions.
			let goalsFailed = false
			const meta = (): AnalyticsResult['meta'] => ({
				provider: 'ga4',
				fetchedAt,
				...(unresolved || goalsFailed ? { goalsUnresolved: true as const } : {}),
			})

			const readMetrics = (
				ms: MetricKey[],
				keys: string[],
				row: protos.google.analytics.data.v1beta.IRow
			): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of ms) {
					const idx = keys.indexOf(METRIC_MAP[m] as string)
					out[m] = toContractValue(m, Number(row.metricValues?.[idx]?.value ?? 0))
				}
				return out
			}

			const filterExprs: protos.google.analytics.data.v1beta.IFilterExpression[] = []
			if (q.path) {
				filterExprs.push(stringFilter('pagePath', 'EXACT', q.path))
			}
			if (q.hostname) {
				filterExprs.push(stringFilter('hostName', 'EXACT', q.hostname))
			}
			// Capability gating (filters/filterOperators) is the real contract upstream; an
			// unsupported dimension is dropped here as the safety net.
			for (const filter of q.filters ?? []) {
				const fieldName = ga4Filters.has(filter.dimension)
					? DIMENSION_MAP[filter.dimension]
					: undefined
				if (!fieldName) {
					continue
				}
				filterExprs.push(stringFilter(fieldName, MATCH_TYPE_MAP[filter.operator], filter.value))
			}
			const goalExprs = hint
				? [
						...filterExprs,
						{
							filter: {
								fieldName: 'eventName',
								inListFilter: { values: hint, caseSensitive: true },
							},
						},
					]
				: filterExprs
			const asFilter = (
				exprs: protos.google.analytics.data.v1beta.IFilterExpression[]
			): protos.google.analytics.data.v1beta.IFilterExpression | undefined =>
				exprs.length === 0
					? undefined
					: exprs.length === 1
						? exprs[0]
						: { andGroup: { expressions: exprs } }

			const request = (
				metrics: string[],
				exprs: protos.google.analytics.data.v1beta.IFilterExpression[],
				extra: protos.google.analytics.data.v1beta.IRunReportRequest
			): protos.google.analytics.data.v1beta.IRunReportRequest => {
				const dimensionFilter = asFilter(exprs)
				return {
					property: `properties/${config.propertyId}`,
					dateRanges: [
						{
							startDate: zonedCalendarDay(q.dateRange.start, q.timezone ?? DEFAULT_TIMEZONE),
							endDate: zonedCalendarDay(q.dateRange.end, q.timezone ?? DEFAULT_TIMEZONE),
						},
					],
					metrics: metrics.map((name) => ({ name })),
					...(dimensionFilter ? { dimensionFilter } : {}),
					...extra,
				}
			}

			const client = await getClient()

			interface PairedReport {
				rows: GoalKeyedRow[]
				totals: Partial<Record<MetricKey, number>> | undefined
			}

			const rowKeys = (row: protos.google.analytics.data.v1beta.IRow): string[] =>
				(row.dimensionValues ?? []).map((value) => value.value ?? '')

			/**
			 * One report shape run twice, plainly and goal-filtered, unioned per row. A row the
			 * goal report has no counterpart for carries no conversions: no key event fired there.
			 * `limit` is the site report's alone, since a goal ranked outside its top N would
			 * otherwise be lost from the union.
			 */
			const runPair = async (
				extra: protos.google.analytics.data.v1beta.IRunReportRequest,
				limit?: number
			): Promise<PairedReport> => {
				const runReport = async (
					metrics: string[],
					exprs: protos.google.analytics.data.v1beta.IFilterExpression[],
					reportExtra: protos.google.analytics.data.v1beta.IRunReportRequest
				) => {
					const [response] = await client.runReport(request(metrics, exprs, reportExtra))
					return response
				}
				// A goal breakdown restricts its own rows, so its one report carries the hint too.
				const siteExprs = goalBreakdown ? goalExprs : filterExprs
				const siteExtra = limit ? { ...extra, limit } : extra
				const pair = await readGoalPair({
					site: siteKeys.length ? () => runReport(siteKeys, siteExprs, siteExtra) : undefined,
					goals: goalKeys.length ? () => runReport(goalKeys, goalExprs, extra) : undefined,
				})
				if (pair.failed) {
					goalsFailed = true
				}
				const keyed = (
					response: protos.google.analytics.data.v1beta.IRunReportResponse | undefined,
					ms: MetricKey[],
					keys: string[]
				): GoalKeyedRow[] | undefined =>
					response?.rows?.map((row) => ({
						keys: rowKeys(row),
						metrics: readMetrics(ms, keys, row),
					})) ?? (response ? [] : undefined)
				const siteTotals = pair.site?.totals?.[0]
				const goalTotals = pair.goals?.totals?.[0]
				return {
					rows: mergeGoalRows(
						keyed(pair.site, siteMetrics, siteKeys),
						keyed(pair.goals, goalMetrics, goalKeys)
					),
					totals: mergeGoalTotals(
						siteTotals ? readMetrics(siteMetrics, siteKeys, siteTotals) : undefined,
						goalTotals ? readMetrics(goalMetrics, goalKeys, goalTotals) : undefined
					),
				}
			}

			if (q.granularity === 'day' && !dims.length) {
				const report = await runPair({
					dimensions: [{ name: 'date' }],
					metricAggregations: [
						'TOTAL',
					] as unknown as protos.google.analytics.data.v1beta.MetricAggregation[],
					orderBys: [{ dimension: { dimensionName: 'date' } }],
				})
				const rows: AnalyticsRow[] = []
				for (const row of report.rows) {
					const ymd = row.keys[0] ?? ''
					const ts = dayIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`)
					if (ts) {
						rows.push({ timestamp: ts, metrics: row.metrics })
					}
				}
				return { rows, totals: report.totals ?? {}, meta: meta() }
			}

			const report = await runPair(
				providerDims.length ? { dimensions: providerDims.map((name) => ({ name })) } : {},
				q.limit
			)

			if (!dims.length) {
				const totals = report.rows[0]?.metrics ?? {}
				return { rows: [{ metrics: totals }], totals, meta: meta() }
			}

			const rows: AnalyticsRow[] = report.rows.map((row) => {
				const dimValues: Partial<Record<DimensionKey, string>> = {}
				for (const d of dims) {
					const idx = providerDims.indexOf(DIMENSION_MAP[d] as string)
					dimValues[d] = row.keys[idx] ?? ''
				}
				return { dimensions: dimValues, metrics: row.metrics }
			})
			return { rows, totals: undefined, meta: meta() }
		},
	}
}
