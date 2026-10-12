import type { Payload } from 'payload'
import { jsLiteral } from '../../capture/jsLiteral'
import type { CaptureSupport } from '../../core/capture'
import {
	type AdapterContext,
	type AnalyticsAdapter,
	type AnalyticsCapabilities,
	type AnalyticsQuery,
	type AnalyticsResult,
	type AnalyticsRow,
	DIMENSION_KEYS,
	type DimensionKey,
	type FilterOperator,
	type MetricKey,
	type MetricReach,
	type MetricValues,
} from '../../core/contract'
import { vendorReading } from '../../core/metricValues'
import type { Ga4Client, Ga4ReportResponse, Ga4ReportRow, Ga4Sdk } from '../../core/sdks'
import { CURRENCY_PATTERN, currencyOption } from '../../goals/currency'
import { GA4_SDK_WARNING, isProductionBuild, loadGa4 } from '../../plugin/peers'
import {
	emptyGoalBreakdown,
	type GoalKeyedRow,
	goalHint,
	hintSlugs,
	mergeGoalRows,
	mergeGoalTotals,
	readGoalPair,
	splitGoalMetrics,
} from '../goalRead'
import {
	calendarDays,
	declaredFilters,
	everyOperatorOn,
	mappedKeys,
	providerMetricKeys,
	readableMetrics,
} from '../mapping'
import { readTime } from '../readTime'
import { datedRows, dayIso } from '../series'
import { upstream } from '../upstream'
import { ga4ExcludeGuard } from './disableKey'
import { ga4EventName } from './eventName'
import { MEASUREMENT_ID_PATTERN } from './measurementId'

export interface Ga4Config {
	/** GA4 property id (numeric), e.g. '123456789'. */
	propertyId: string
	/** Service-account credentials. */
	credentials: { client_email: string; private_key: string }
	/** GCP project id; inferred from the credentials when omitted. */
	projectId?: string
	/** Maximum days of historical data. Defaults to 425 (GA4's rolling-window limit). Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/**
	 * Public measurement id (`G-XXXXXXX`). Setting it turns on capture: the tag is loaded
	 * from googletagmanager.com and booted with gtag.
	 */
	measurementId?: string
	/**
	 * `{ BetaAnalyticsDataClient }` from `@google-analytics/data`. Unset, the plugin's `sdks.ga4`
	 * serves, and without either it is loaded at runtime, which a standalone build does not ship.
	 */
	sdk?: Ga4Sdk
	/**
	 * The property's ISO 4217 currency, used only when an answer names none; GA4's own wins. Anything
	 * but such a code throws when the adapter is built.
	 */
	currency?: string
}

/** How long one report may take when the adapter is called outside the engine, which sets its own. */
const DEFAULT_REPORT_TIMEOUT_MS = 60_000

/**
 * Cancels a Data API call when its read gives up, where `cancel` survives: `@google-analytics/data`
 * 6.1 drops it, leaving the call's own gRPC `timeout` to bound it.
 */
const cancelWhenAborted = (call: Promise<unknown>, signal: AbortSignal | undefined): void => {
	const cancel: unknown = Reflect.get(call, 'cancel')
	if (!signal || typeof cancel !== 'function') {
		return
	}
	const onAbort = (): void => {
		Reflect.apply(cancel, call, [])
	}
	if (signal.aborted) {
		onAbort()
		return
	}
	signal.addEventListener('abort', onAbort, { once: true })
	void call.then(
		() => signal.removeEventListener('abort', onAbort),
		() => signal.removeEventListener('abort', onAbort)
	)
}

/**
 * Google's install snippet, inline first as consent mode expects, led by the exclusion guard. The
 * tag loads from Google's CDN, so `routes` stays empty and the slot's proxy mount answers 404.
 */
function buildCapture(measurementId: string): CaptureSupport {
	const id = jsLiteral(measurementId)
	return {
		proxy: { routes: [] },
		snippet: () => ({
			scripts: [
				{
					inline: `${ga4ExcludeGuard(measurementId)}window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config",${id})`,
				},
				{
					src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`,
					async: true,
				},
			],
		}),
		client: { kind: 'ga4', measurementId },
	}
}

const METRIC_MAP: Partial<Record<MetricKey, string>> = {
	pageviews: 'screenPageViews',
	visitors: 'totalUsers',
	visits: 'sessions',
	sessions: 'sessions',
	bounceRate: 'bounceRate',
	visitDuration: 'averageSessionDuration',
	events: 'eventCount',
	conversions: 'keyEvents',
	revenue: 'totalRevenue',
}

const ENGAGED_SECONDS = 'userEngagementDuration'
const VIEWS = 'screenPageViews'

/**
 * The GA4 metrics each contract metric is read from. Time on page is engaged seconds over views;
 * both are sums, so the ratio holds per row and for the totals alike.
 */
const METRIC_SOURCES: Partial<Record<MetricKey, string | readonly string[]>> = {
	...METRIC_MAP,
	avgDuration: [ENGAGED_SECONDS, VIEWS],
}

const DIMENSION_MAP: Partial<Record<DimensionKey, string>> = {
	page: 'pagePath',
	referrer: 'pageReferrer',
	source: 'sessionSource',
	channel: 'sessionDefaultChannelGroup',
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
 * Metrics GA4 answers only for a goal-restricted read. `keyEvents` counts only events the property
 * marks as key events, so a goal here that GA4 does not mark reports 0.
 */
const GOAL_METRICS: ReadonlySet<MetricKey> = new Set(['conversions'])

/**
 * The hint's slugs by the GA4 event name each normalizes to, for the request and mapping rows back.
 * Two slugs normalizing alike are one GA4 event: the first slug owns its rows.
 */
const goalSlugsByEventName = (slugs: string[]): Map<string, string> => {
	const byName = new Map<string, string>()
	for (const slug of slugs) {
		const name = ga4EventName(slug)
		if (!byName.has(name)) {
			byName.set(name, slug)
		}
	}
	return byName
}

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

// The Data API defaults caseSensitive to false, so it is explicit: `contains` stays
// insensitive like native and Umami's ilike, while `eq` and `matches` compare literally.
const CASE_SENSITIVE: Record<StringMatchType, boolean> = {
	EXACT: true,
	CONTAINS: false,
	FULL_REGEXP: true,
}

/**
 * A filter expression as the Data API reads one (`FilterExpression` in its REST reference), written
 * here so the adapter needs no type of the SDK.
 */
interface FilterExpression {
	filter?: {
		fieldName: string
		stringFilter?: { matchType: StringMatchType; value: string; caseSensitive: boolean }
		inListFilter?: { values: string[]; caseSensitive: boolean }
	}
	andGroup?: { expressions: FilterExpression[] }
}

/** The parts of a `RunReportRequest` a read adds to the property, the window and the metrics. */
interface ReportShape {
	dimensions?: Array<{ name: string }>
	metricAggregations?: Array<'TOTAL'>
	orderBys?: Array<{ dimension: { dimensionName: string } }>
	limit?: number
}

const stringFilter = (
	fieldName: string,
	matchType: StringMatchType,
	value: string
): FilterExpression => ({
	filter: {
		fieldName,
		stringFilter: { matchType, value, caseSensitive: CASE_SENSITIVE[matchType] },
	},
})

/** `exprs` as one dimension filter: none, the only one, or all of them and-ed. */
const allOf = (exprs: FilterExpression[]): FilterExpression | undefined =>
	exprs.length > 1 ? { andGroup: { expressions: exprs } } : exprs[0]

const ga4Metrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'avgDuration',
	'visitDuration',
	'events',
	'conversions',
	'revenue',
])
const ga4Dimensions = mappedKeys(DIMENSION_KEYS, DIMENSION_MAP)
/**
 * Views are page_view and screen_view events only, so a time on page per event name divides the
 * engagement of one event by the views of another: it is read under every other breakdown.
 */
const ga4Reach: Partial<Record<MetricKey, MetricReach>> = {
	avgDuration: {
		dimensions: [...ga4Dimensions].filter(
			(dimension) => dimension !== 'event' && dimension !== 'goal'
		),
	},
}
const ga4Filters = everyOperatorOn(ga4Dimensions)

// GA4 returns bounceRate as a 0..1 ratio and averageSessionDuration in seconds; the
// contract uses a 0..100 percentage and milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number => {
	if (metric === 'visitDuration') {
		return Math.round(raw * 1000)
	}
	if (metric === 'bounceRate') {
		return Math.round(raw * 100)
	}
	return raw
}

interface Ga4Reading {
	metrics: MetricValues
	/** The views each time on page was taken over, which folds days into weeks exactly. */
	samples?: Partial<Record<MetricKey, number>>
}

/** One report row's contract metrics, each read back by GA4 name from the report's `names`. */
const readRow = (metrics: MetricKey[], names: string[], row: Ga4ReportRow): Ga4Reading => {
	const raw = (name: string): unknown => row.metricValues?.[names.indexOf(name)]?.value
	const out: MetricValues = {}
	let samples: Ga4Reading['samples']
	for (const metric of metrics) {
		if (metric === 'avgDuration') {
			const views = vendorReading('pageviews', raw(VIEWS)) ?? 0
			const engaged = vendorReading('avgDuration', raw(ENGAGED_SECONDS))
			out.avgDuration = views > 0 && engaged !== null ? Math.round((engaged / views) * 1000) : null
			samples = { avgDuration: views }
			continue
		}
		const name = METRIC_MAP[metric]
		const value = name === undefined ? null : vendorReading(metric, raw(name))
		out[metric] = value === null ? null : toContractValue(metric, value)
	}
	return samples ? { metrics: out, samples } : { metrics: out }
}

/** A report's rows keyed by their dimension values; undefined when the report was never run. */
const keyedRows = (
	response: Ga4ReportResponse | undefined,
	metrics: MetricKey[],
	names: string[]
): GoalKeyedRow[] | undefined =>
	response?.rows?.map((row) => ({
		keys: (row.dimensionValues ?? []).map((value) => value.value ?? ''),
		...readRow(metrics, names, row),
	})) ?? (response ? [] : undefined)

const totalsOf = (
	response: Ga4ReportResponse | undefined,
	metrics: MetricKey[],
	names: string[]
): MetricValues | undefined => {
	const row = response?.totals?.[0]
	return row ? readRow(metrics, names, row).metrics : undefined
}

/** GA4's `date` dimension value (`YYYYMMDD`) as a UTC-day ISO string. */
const ga4DayIso = (ymd: string): string | null =>
	dayIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`)

export function ga4(config: Ga4Config): AnalyticsAdapter {
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 425

	const capabilities: AnalyticsCapabilities = {
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: ga4Metrics,
		dimensions: ga4Dimensions,
		metricReach: ga4Reach,
		filters: ga4Filters,
		semantics: { visitors: 'distinct', sessions: 'provider' },
		rateLimit: { maxConcurrent: 10, readsCountAsUsage: true },
		recommendedTtl: { realtime: 300, aggregate: 21600 },
		upstreamAware: true,
	}
	const configCurrency = currencyOption('ga4({ currency })', config.currency)

	/** One client per Payload instance, so closing one instance's leaves the others' open. */
	const clients = new WeakMap<object, Promise<Ga4Client>>()
	/** The instances this adapter was closed for, which get no client again until attached anew. */
	const closed = new WeakSet<object>()
	/** Whom a read with no instance in its context shares a client with. */
	const unattached = {}
	/** The plugin's `sdks.ga4`, handed over when the plugin registers this adapter. */
	let pluginSdk: Ga4Sdk | undefined
	let warned = false
	const sdk = (): Ga4Sdk | undefined => config.sdk ?? pluginSdk

	const getClient = (payload: Payload | undefined): Promise<Ga4Client> => {
		const owner = payload ?? unattached
		const held = clients.get(owner)
		if (held) {
			return held
		}
		// A read that reaches a closed adapter late (a retired runtime's refresh) would otherwise
		// open a client nothing ever closes.
		if (closed.has(owner)) {
			return Promise.reject(new Error('analytics: this GA4 source was closed'))
		}
		const created = (async () => {
			const mod = sdk() ?? (await loadGa4())
			return new mod.BetaAnalyticsDataClient({
				credentials: config.credentials,
				...(config.projectId ? { projectId: config.projectId } : {}),
			})
		})()
		clients.set(owner, created)
		return created
	}

	const measurementId = config.measurementId
	return {
		id: 'ga4',
		label: 'Google Analytics 4',
		capabilities,
		// An id that is not a bare token is dropped rather than escaped: it lands in an inline
		// script and in the tag URL, and no legitimate measurement id needs anything else.
		...(measurementId && MEASUREMENT_ID_PATTERN.test(measurementId)
			? { capture: buildCapture(measurementId) }
			: {}),
		isConfigured: () =>
			Boolean(
				config.propertyId && config.credentials?.client_email && config.credentials?.private_key
			),
		register(_config, context) {
			pluginSdk = context?.sdks?.ga4
		},
		// At boot, before the first read fails in front of an editor.
		attach(payload: Payload) {
			closed.delete(payload)
			if (!warned && sdk() === undefined && isProductionBuild()) {
				warned = true
				payload.logger?.warn(GA4_SDK_WARNING)
			}
		},
		async close(payload: Payload) {
			closed.add(payload)
			const held = clients.get(payload)
			clients.delete(payload)
			const client = await held?.catch(() => undefined)
			await client?.close?.()
		},
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = readTime(ctx)
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const goalBreakdown = dims.includes('goal')
			const hint = goalHint(q)
			const empty = goalBreakdown ? emptyGoalBreakdown({ provider: 'ga4', fetchedAt, hint }) : null
			if (empty) {
				return empty
			}
			const { siteMetrics, goalMetrics, unresolved } = splitGoalMetrics({
				wanted: readableMetrics(capabilities, q, dims),
				goalOnly: GOAL_METRICS,
				goalBreakdown,
				hint,
			})
			const siteNames = providerMetricKeys(siteMetrics, METRIC_SOURCES)
			const goalNames = providerMetricKeys(goalMetrics, METRIC_SOURCES)
			const providerDims = [...new Set(dims.flatMap((d) => DIMENSION_MAP[d] ?? []))]
			// Set when GA4 rejects a goal report the site report survived, so the rows keep their
			// site metrics and lose only their conversions.
			let goalsFailed = false
			// What the answers said about themselves: a sampled report anywhere makes the read an estimate.
			let sampled = false
			let reportedCurrency: string | undefined
			const meta = (): AnalyticsResult['meta'] => {
				const currency = reportedCurrency ?? configCurrency
				return {
					provider: 'ga4',
					fetchedAt,
					...(currency ? { currency } : {}),
					...(sampled ? { sampled: true } : {}),
					...(unresolved || goalsFailed ? { goalsUnresolved: true as const } : {}),
				}
			}

			const filterExprs: FilterExpression[] = []
			if (q.path) {
				filterExprs.push(stringFilter('pagePath', 'EXACT', q.path))
			}
			if (q.hostname) {
				filterExprs.push(stringFilter('hostName', 'EXACT', q.hostname))
			}
			for (const { filter, field } of declaredFilters(capabilities, q.filters, DIMENSION_MAP)) {
				filterExprs.push(stringFilter(field, MATCH_TYPE_MAP[filter.operator], filter.value))
			}
			const slugs = hintSlugs(hint)
			const goalSlugs = slugs ? goalSlugsByEventName(slugs) : null
			const goalExprs: FilterExpression[] = goalSlugs
				? [
						...filterExprs,
						{
							filter: {
								fieldName: 'eventName',
								inListFilter: { values: [...goalSlugs.keys()], caseSensitive: true },
							},
						},
					]
				: filterExprs
			// A goal breakdown restricts its own rows, so its one report carries the hint too.
			const siteExprs = goalBreakdown ? goalExprs : filterExprs

			const [startDate, endDate] = calendarDays(q)
			const client = await getClient(ctx.payload)

			// Each report is one upstream request with its own token, so a paired read spends two. It
			// runs with no retry of the SDK's own (the lane retries) and a deadline of what the read has left.
			const runReport = (
				names: string[],
				exprs: FilterExpression[],
				shape: ReportShape
			): Promise<Ga4ReportResponse> =>
				upstream(ctx, async (signal) => {
					const dimensionFilter = allOf(exprs)
					const request = {
						property: `properties/${config.propertyId}`,
						dateRanges: [{ startDate, endDate }],
						metrics: names.map((name) => ({ name })),
						...(dimensionFilter ? { dimensionFilter } : {}),
						...shape,
					}
					const timeout = Math.max(1, Math.floor(ctx.remainingMs?.() ?? DEFAULT_REPORT_TIMEOUT_MS))
					const call = client.runReport(request, { timeout, retry: null })
					cancelWhenAborted(call, signal)
					const [response] = await call
					if ((response.metadata?.samplingMetadatas?.length ?? 0) > 0) {
						sampled = true
					}
					const code = response.metadata?.currencyCode?.toUpperCase()
					if (code && CURRENCY_PATTERN.test(code)) {
						reportedCurrency = code
					}
					return response
				})

			/**
			 * One report shape run plainly and goal-filtered, unioned per row. `limit` is the site report's
			 * alone, since a goal ranked outside its top N would otherwise drop out of the union.
			 */
			const runPair = async (
				shape: ReportShape,
				limit?: number
			): Promise<{ rows: GoalKeyedRow[]; totals: MetricValues | undefined }> => {
				const siteShape = limit ? { ...shape, limit } : shape
				const pair = await readGoalPair({
					site: siteNames.length ? () => runReport(siteNames, siteExprs, siteShape) : undefined,
					goals: goalNames.length ? () => runReport(goalNames, goalExprs, shape) : undefined,
				})
				if (pair.failed) {
					goalsFailed = true
				}
				return {
					rows: mergeGoalRows(
						keyedRows(pair.site, siteMetrics, siteNames),
						keyedRows(pair.goals, goalMetrics, goalNames)
					),
					totals: mergeGoalTotals(
						totalsOf(pair.site, siteMetrics, siteNames),
						totalsOf(pair.goals, goalMetrics, goalNames)
					),
				}
			}

			if (q.granularity === 'day' && !dims.length) {
				const report = await runPair({
					dimensions: [{ name: 'date' }],
					metricAggregations: ['TOTAL'],
					orderBys: [{ dimension: { dimensionName: 'date' } }],
				})
				return {
					rows: datedRows(report.rows, ga4DayIso),
					totals: report.totals ?? {},
					meta: meta(),
				}
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
				const dimensions: Partial<Record<DimensionKey, string>> = {}
				for (const d of dims) {
					const name = DIMENSION_MAP[d]
					const value =
						(name === undefined ? undefined : row.keys[providerDims.indexOf(name)]) ?? ''
					// A `goal` row reports the slug it was asked for; an `event` row reports GA4's own
					// event name, even though both read the same dimension.
					dimensions[d] = d === 'goal' ? (goalSlugs?.get(value) ?? value) : value
				}
				return {
					dimensions,
					metrics: row.metrics,
					...(row.samples ? { samples: row.samples } : {}),
				}
			})
			return { rows, totals: undefined, meta: meta() }
		},
	}
}
