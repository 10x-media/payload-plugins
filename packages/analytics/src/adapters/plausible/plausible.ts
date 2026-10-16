import { jsLiteral } from '../../capture/jsLiteral'
import {
	adapterWithoutConsent,
	cookielessCapture,
	WITHOUT_CONSENT_LEVELS,
} from '../../capture/withoutConsent'
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
import type { FetchLike } from '../../core/fetch'
import { vendorReading } from '../../core/metricValues'
import { type AdapterLabelOption, adapterLabel } from '../../core/sourceLabel'
import { currencyOption } from '../../goals/currency'
import type { WithoutConsentLevel } from '../../tracker/config'
import {
	emptyGoalBreakdown,
	type GoalKeyedRow,
	goalHint,
	hintSlugs,
	mergeGoalRows,
	readGoalPair,
	splitGoalMetrics,
} from '../goalRead'
import { withoutTrailingSlash } from '../http/baseUrl'
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
import { upstreamJson } from '../upstream'
import { isScriptId } from './scriptId'

export interface PlausibleConfig {
	/**
	 * The source's name in pickers and listings: a string, a map by admin language (read like
	 * `view.navLabel`), or a function naming it per reader and scope. Default `'Plausible'`.
	 */
	label?: AdapterLabelOption
	siteId: string
	apiKey: string
	/**
	 * Address of a self-hosted Community Edition, with the base path when it runs under one.
	 * Defaults to Plausible Cloud.
	 */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/**
	 * Site domain for the legacy script tag (`data-domain`). Takes priority over `scriptId`.
	 * The adapter declares `capture` only when one of the two is set.
	 */
	domain?: string
	/**
	 * Per-site tracker id (`pa-<id>.js`) for the newer per-site script model: letters, digits, `_`
	 * and `-`. Any other value is dropped, and capture then needs `domain`.
	 */
	scriptId?: string
	/**
	 * The ISO 4217 currency of the site's revenue goals. Declaring it turns on `revenue`: Plausible
	 * errors the whole request for `total_revenue` on a site without a revenue goal.
	 */
	revenueCurrency?: string
	/** The fetch reads and the capture proxy reach Plausible with. Unset, the global fetch. */
	fetch?: FetchLike
	/**
	 * What this source's held slot does without consent, over `capture.withoutConsent`. Plausible
	 * stores nothing on the device, so `'cookieless'` loads the script as it is; `'off'` holds it.
	 */
	withoutConsent?: WithoutConsentLevel
}

const PLAUSIBLE_CLOUD = 'https://plausible.io'

/**
 * Plausible's official per-site stub, safe beside the async loader in either order. `init` is
 * guarded with `||` because the loader may win the race, and overwriting it would lose the endpoint.
 */
const PLAUSIBLE_STUB =
	'window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)},window.plausible.init=window.plausible.init||function(e){window.plausible.o=e||{}};'

function buildCapture(
	config: PlausibleConfig,
	scriptId: string | undefined,
	withoutConsent: WithoutConsentLevel | undefined
): CaptureSupport {
	const base = withoutTrailingSlash(config.host ?? PLAUSIBLE_CLOUD)
	const scripts = (path: string) => {
		if (config.domain) {
			return [
				{
					src: `${path}/js/script.js`,
					defer: true,
					attrs: { 'data-domain': config.domain, 'data-api': `${path}/api/event` },
				},
			]
		}
		if (scriptId) {
			return [
				{ src: `${path}/js/pa-${encodeURIComponent(scriptId)}.js`, async: true },
				{
					inline: `${PLAUSIBLE_STUB}plausible.init({endpoint:${jsLiteral(`${path}/api/event`)}})`,
				},
			]
		}
		return []
	}
	return {
		proxy: {
			routes: [
				{ source: '/js/:script*', upstream: `${base}/js/:script*`, kind: 'script' },
				{ source: '/api/event', upstream: `${base}/api/event`, kind: 'data' },
			],
			...(config.fetch ? { fetch: config.fetch } : {}),
		},
		snippet: ({ path }) => ({ scripts: scripts(path) }),
		client: { kind: 'plausible' },
		...cookielessCapture({ kind: 'inherent' }, withoutConsent),
	}
}

const METRIC_MAP: Partial<Record<MetricKey, string>> = {
	pageviews: 'pageviews',
	visitors: 'visitors',
	visits: 'visits',
	sessions: 'visits',
	bounceRate: 'bounce_rate',
	visitDuration: 'visit_duration',
	events: 'events',
	scrollDepth: 'scroll_depth',
	// Both only mean anything under an event:goal filter or dimension, which is the one
	// shape they are requested in: "events" on goal rows is Plausible's Total Conversions.
	conversions: 'events',
	revenue: 'total_revenue',
}

/** Metrics Plausible answers only for a goal-restricted read. */
const GOAL_METRICS: ReadonlySet<MetricKey> = new Set(['conversions', 'revenue'])

const DIMENSION_MAP: Partial<Record<DimensionKey, string>> = {
	page: 'event:page',
	source: 'visit:source',
	channel: 'visit:channel',
	referrer: 'visit:referrer',
	device: 'visit:device',
	browser: 'visit:browser',
	os: 'visit:os',
	country: 'visit:country',
	region: 'visit:region',
	city: 'visit:city',
	utmSource: 'visit:utm_source',
	utmMedium: 'visit:utm_medium',
	utmCampaign: 'visit:utm_campaign',
	goal: 'event:goal',
}

/** `matches` is an re2 full match, so a pattern must cover the whole value (`/docs/.*`, not `^/docs`). */
const OPERATOR_MAP: Record<FilterOperator, string> = {
	eq: 'is',
	contains: 'contains',
	matches: 'matches',
}

const plausibleMetrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'visitDuration',
	'events',
	'scrollDepth',
	'conversions',
	'revenue',
])
// A site without revenue goals has no total_revenue at all, so the metric is opt-in.
const plausibleMetricsNoRevenue: ReadonlySet<MetricKey> = new Set(
	[...plausibleMetrics].filter((m) => m !== 'revenue')
)
const plausibleDimensions = mappedKeys(DIMENSION_KEYS, DIMENSION_MAP)
const withoutGoal: readonly DimensionKey[] = [...plausibleDimensions].filter(
	(dimension) => dimension !== 'goal'
)
/**
 * The Stats API refuses bounce rate and duration under event dimensions but event:page, and scroll
 * depth without event:page. Its `time_on_page` is per visit, not per pageview, so none is offered.
 */
const plausibleReach: Partial<Record<MetricKey, MetricReach>> = {
	bounceRate: { dimensions: withoutGoal },
	visitDuration: { dimensions: withoutGoal },
	scrollDepth: { dimensions: withoutGoal, requires: 'page' },
}
const plausibleFilters = everyOperatorOn(plausibleDimensions)

/** One Stats API v2 filter: `[operator, dimension, values]`. */
type PlausibleClause = [operator: string, dimension: string, values: string[]]

/** The parts of a v2 query a read adds to the site, the window, the metrics and the filters. */
interface QueryShape {
	dimensions?: string[]
}

/** `total_revenue` is an object, and null when the rows mix currencies. Every other metric is a number. */
type PlausibleMetricValue = number | { value: number | null } | null

interface PlausibleResult {
	metrics: PlausibleMetricValue[]
	dimensions: string[]
}

interface PlausibleResponse {
	results: PlausibleResult[]
}

const revenueAmount = (raw: PlausibleMetricValue | undefined): number | undefined =>
	typeof raw === 'object' && raw !== null && typeof raw.value === 'number' ? raw.value : undefined

// visit_duration is reported in seconds; the contract's visitDuration is milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number =>
	metric === 'visitDuration' ? Math.round(raw * 1000) : raw

/** One result row's contract metrics, each read back by Plausible name from the request's `names`. */
const readRow = (metrics: MetricKey[], names: string[], row: PlausibleResult): MetricValues => {
	const out: MetricValues = {}
	for (const metric of metrics) {
		const name = METRIC_MAP[metric]
		const raw = name === undefined ? undefined : row.metrics[names.indexOf(name)]
		if (metric === 'revenue') {
			const amount = revenueAmount(raw)
			if (amount !== undefined) {
				out.revenue = amount
			}
			continue
		}
		// Plausible answers an average it has no samples for with null, which stays no
		// data here rather than becoming a 0 the reports would read as a real value.
		const value = vendorReading(metric, raw)
		out[metric] = value === null ? null : toContractValue(metric, value)
	}
	return out
}

/** A response's rows keyed by their dimension values; undefined when the request was never sent. */
const keyedRows = (
	response: PlausibleResponse | undefined,
	metrics: MetricKey[],
	names: string[]
): GoalKeyedRow[] | undefined =>
	response?.results.map((row) => ({ keys: row.dimensions, metrics: readRow(metrics, names, row) }))

/**
 * The Plausible adapter. A goal's slug must equal its display name in the site's goal list for its
 * conversions to read; `revenue` needs `revenueCurrency`.
 */
export function plausible(config: PlausibleConfig): AnalyticsAdapter {
	const host = withoutTrailingSlash(config.host ?? PLAUSIBLE_CLOUD)
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730
	const revenueCurrency = currencyOption('plausible({ revenueCurrency })', config.revenueCurrency)
	const revenueGoals = revenueCurrency !== undefined
	// Dropped rather than escaped, like GA4's measurement id: it lands in the page's script address.
	const scriptId = isScriptId(config.scriptId) ? config.scriptId : undefined
	const withoutConsent = adapterWithoutConsent(
		config.withoutConsent,
		'plausible({ withoutConsent })',
		WITHOUT_CONSENT_LEVELS
	)

	const capabilities: AnalyticsCapabilities = {
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: revenueGoals ? plausibleMetrics : plausibleMetricsNoRevenue,
		dimensions: plausibleDimensions,
		metricReach: plausibleReach,
		filters: plausibleFilters,
		semantics: { visitors: 'distinct', sessions: 'provider' },
		rateLimit: { requestsPerHour: 600 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
		upstreamAware: true,
	}
	return {
		id: 'plausible',
		...adapterLabel(config.label, 'Plausible', 'plausible({ label })'),
		capabilities,
		...(config.domain || scriptId
			? { capture: buildCapture(config, scriptId, withoutConsent) }
			: {}),
		isConfigured: () => Boolean(config.siteId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = readTime(ctx)
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const goalBreakdown = dims.includes('goal')
			const hint = goalHint(q)
			const empty = goalBreakdown
				? emptyGoalBreakdown({ provider: 'plausible', fetchedAt, hint })
				: null
			if (empty) {
				return empty
			}
			const { siteMetrics, goalMetrics, unresolved } = splitGoalMetrics({
				wanted: readableMetrics(capabilities, q, dims),
				goalOnly: GOAL_METRICS,
				goalBreakdown,
				hint,
			})
			const siteNames = providerMetricKeys(siteMetrics, METRIC_MAP)
			const goalNames = providerMetricKeys(goalMetrics, METRIC_MAP)

			const filters: PlausibleClause[] = []
			if (q.path) {
				filters.push(['is', 'event:page', [q.path]])
			}
			if (q.hostname) {
				filters.push(['is', 'event:hostname', [q.hostname]])
			}
			for (const { filter, field } of declaredFilters(capabilities, q.filters, DIMENSION_MAP)) {
				filters.push([OPERATOR_MAP[filter.operator], field, [filter.value]])
			}
			const slugs = hintSlugs(hint)
			const goalFilters: PlausibleClause[] = slugs
				? [...filters, ['is', 'event:goal', slugs]]
				: filters
			const siteFilters = goalBreakdown ? goalFilters : filters
			// Set when the provider rejects a goal request the site request survived, so the
			// rows keep their site metrics and lose only their goal numbers.
			let goalsFailed = false
			const meta = (): AnalyticsResult['meta'] => ({
				provider: 'plausible',
				fetchedAt,
				...(revenueCurrency ? { currency: revenueCurrency } : {}),
				...(unresolved || goalsFailed ? { goalsUnresolved: true as const } : {}),
			})

			const dateRange = calendarDays(q)
			const postQuery = (
				names: string[],
				clauses: PlausibleClause[],
				shape: QueryShape
			): Promise<PlausibleResponse> =>
				upstreamJson<PlausibleResponse>(ctx, `${host}/api/v2/query`, {
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: {
						site_id: config.siteId,
						metrics: names,
						date_range: dateRange,
						...(clauses.length ? { filters: clauses } : {}),
						...shape,
					},
					provider: 'plausible',
					fetch: config.fetch,
				})

			/**
			 * One request shape read twice, plainly and goal-filtered, unioned per row. A row the
			 * goal read has no counterpart for carries no conversions: no goal was completed there.
			 */
			const readPair = async (shape: QueryShape): Promise<GoalKeyedRow[]> => {
				const pair = await readGoalPair({
					site: siteNames.length ? () => postQuery(siteNames, siteFilters, shape) : undefined,
					goals: goalNames.length ? () => postQuery(goalNames, goalFilters, shape) : undefined,
				})
				if (pair.failed) {
					goalsFailed = true
				}
				return mergeGoalRows(
					keyedRows(pair.site, siteMetrics, siteNames),
					keyedRows(pair.goals, goalMetrics, goalNames)
				)
			}

			if (q.granularity === 'day' && !dims.length) {
				const [series, totalRows] = await Promise.all([
					readPair({ dimensions: ['time:day'] }),
					readPair({}),
				])
				return {
					rows: datedRows(series, dayIso),
					totals: totalRows[0]?.metrics ?? {},
					meta: meta(),
				}
			}

			if (!dims.length) {
				const totals = (await readPair({}))[0]?.metrics ?? {}
				return { rows: [{ metrics: totals }], totals, meta: meta() }
			}

			const merged = await readPair({ dimensions: dims.flatMap((d) => DIMENSION_MAP[d] ?? []) })
			const rows: AnalyticsRow[] = merged.map((row) => {
				const dimensions: Partial<Record<DimensionKey, string>> = {}
				for (const [i, d] of dims.entries()) {
					dimensions[d] = row.keys[i] ?? ''
				}
				return { dimensions, metrics: row.metrics }
			})
			return { rows, totals: undefined, meta: meta() }
		},
	}
}
