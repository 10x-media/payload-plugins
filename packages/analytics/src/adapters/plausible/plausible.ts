import type { CaptureSupport } from '../../core/capture'
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
	emptyGoalBreakdown,
	type GoalKeyedRow,
	goalHint,
	hintSlugs,
	mergeGoalRows,
	providerMetricKeys,
	readGoalPair,
	splitGoalMetrics,
} from '../goalRead'
import { fetchJson } from '../http/fetchJson'
import { dayIso } from '../series'

export interface PlausibleConfig {
	siteId: string
	apiKey: string
	/** Base URL for self-hosted CE. Defaults to Plausible Cloud. */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/**
	 * Site domain for the legacy script tag (`data-domain`). Takes priority over `scriptId`.
	 * The adapter declares `capture` only when one of the two is set.
	 */
	domain?: string
	/**
	 * Per-site tracker id (`pa-<id>.js`) for the newer per-site script model. The adapter
	 * declares `capture` only when one of it and `domain` is set.
	 */
	scriptId?: string
	/**
	 * The ISO currency of the site's revenue goals. Declaring it turns on the `revenue`
	 * metric: Plausible serves `total_revenue` only where a revenue goal exists, and errors
	 * the whole request on a site that has none.
	 */
	revenueCurrency?: string
}

/**
 * Plausible's official per-site stub, as served on plausible.io's own pages: `plausible.q`
 * queues calls the tracker replays on load, and `plausible.init` parks the options on
 * `plausible.o` for it to read. It makes the inline safe next to the async loader in either
 * order, which the bare `plausible.init(...)` call was not. `init` is guarded with `||`
 * (the official one assigns unconditionally) because here the tracker is a separate async
 * tag and may win the race, and overwriting the real `init` with the stub would lose the
 * endpoint.
 */
const PLAUSIBLE_STUB =
	'window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)},window.plausible.init=window.plausible.init||function(e){window.plausible.o=e||{}};'

function buildCapture(config: PlausibleConfig): CaptureSupport {
	const base = config.host ?? 'https://plausible.io'
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
		if (config.scriptId) {
			return [
				{ src: `${path}/js/pa-${config.scriptId}.js`, async: true },
				{
					inline: `${PLAUSIBLE_STUB}plausible.init({endpoint:${JSON.stringify(`${path}/api/event`)}})`,
				},
			]
		}
		return []
	}
	return {
		proxy: {
			routes: [
				{ source: '/js/:script*', upstream: `${base}/js/:script*` },
				{ source: '/api/event', upstream: `${base}/api/event` },
			],
		},
		snippet: ({ path }) => ({ scripts: scripts(path) }),
		client: { kind: 'plausible' },
	}
}

const METRIC_MAP: Partial<Record<MetricKey, string>> = {
	pageviews: 'pageviews',
	visitors: 'visitors',
	visits: 'visits',
	sessions: 'visits',
	bounceRate: 'bounce_rate',
	avgDuration: 'visit_duration',
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

/**
 * Stats API v2 filter operators, available on every dimension this adapter offers as a
 * filter (event:goal is the grammar's one exception, taking `is` and `contains` only, and
 * is a breakdown here rather than a filter). `matches` is an re2 full match, so a pattern
 * has to cover the whole value (`/docs/.*`, not `^/docs`).
 */
const OPERATOR_MAP: Record<FilterOperator, string> = {
	eq: 'is',
	contains: 'contains',
	matches: 'matches',
}

const plausibleMetrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
// A site without revenue goals has no total_revenue at all, so the metric is opt-in.
const plausibleMetricsNoRevenue: ReadonlySet<MetricKey> = new Set(
	[...plausibleMetrics].filter((m) => m !== 'revenue')
)
const plausibleDimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)
// `goal` is a breakdown, not a filter: the read's own goal slugs own the event:goal clause,
// and the grammar allows no `matches` on it anyway.
const plausibleFilters: ReadonlySet<DimensionKey> = new Set(
	[...plausibleDimensions].filter((dimension) => dimension !== 'goal')
)

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

// visit_duration is reported in seconds; the contract avgDuration is milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number =>
	metric === 'avgDuration' ? Math.round(raw * 1000) : raw

/**
 * Plausible identifies a goal by its display name in the site's own goal list ("Signup",
 * "Visit /thank-you"), so a plugin goal's slug must equal that name for its conversions to
 * read. Conversions are the `events` metric on goal rows, which is the dashboard's Total
 * Conversions; revenue is `total_revenue`, which Plausible serves only for a revenue goal
 * and reports as an object whose `value` is null when the rows mix currencies. Revenue is
 * offered only when `revenueCurrency` says the site has such a goal: asking for it on a site
 * without one errors the request.
 */
export function plausible(config: PlausibleConfig): AnalyticsAdapter {
	const host = config.host ?? 'https://plausible.io'
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730
	const revenueGoals = Boolean(config.revenueCurrency)

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: revenueGoals ? plausibleMetrics : plausibleMetricsNoRevenue,
		dimensions: plausibleDimensions,
		filters: plausibleFilters,
		filterOperators: new Set(['eq', 'contains', 'matches']),
		batchPageReport: true,
		rateLimit: { requestsPerHour: 600 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
	}

	return {
		id: 'plausible',
		label: 'Plausible',
		capabilities,
		...(config.domain || config.scriptId ? { capture: buildCapture(config) } : {}),
		isConfigured: () => Boolean(config.siteId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const goalBreakdown = dims.includes('goal')
			const hint = goalHint(q)
			const slugs = hintSlugs(hint)
			const empty = goalBreakdown ? emptyGoalBreakdown({ provider: 'plausible', q, hint }) : null
			if (empty) {
				return empty
			}
			const wanted = q.metrics.filter((m) => METRIC_MAP[m] && (revenueGoals || m !== 'revenue'))
			const { siteMetrics, goalMetrics, unresolved } = splitGoalMetrics({
				wanted,
				goalOnly: GOAL_METRICS,
				goalBreakdown,
				hint,
			})
			const siteKeys = providerMetricKeys(siteMetrics, METRIC_MAP)
			const goalKeys = providerMetricKeys(goalMetrics, METRIC_MAP)

			const filters: Array<[string, string, string[]]> = []
			if (q.path) {
				filters.push(['is', 'event:page', [q.path]])
			}
			if (q.hostname) {
				filters.push(['is', 'event:hostname', [q.hostname]])
			}
			// Capability gating (filters/filterOperators) is the real contract upstream; an
			// unsupported dimension is dropped here as the safety net.
			for (const filter of q.filters ?? []) {
				const mapped = plausibleFilters.has(filter.dimension)
					? DIMENSION_MAP[filter.dimension]
					: undefined
				if (!mapped) {
					continue
				}
				filters.push([OPERATOR_MAP[filter.operator], mapped, [filter.value]])
			}
			const goalFilters: Array<[string, string, string[]]> = slugs
				? [...filters, ['is', 'event:goal', slugs]]
				: filters
			const siteFilters = goalBreakdown ? goalFilters : filters
			// Set when the provider rejects a goal request the site request survived, so the
			// rows keep their site metrics and lose only their goal numbers.
			let goalsFailed = false
			const meta = (): AnalyticsResult['meta'] => ({
				provider: 'plausible',
				fetchedAt,
				...(unresolved || goalsFailed ? { goalsUnresolved: true as const } : {}),
			})

			const readMetrics = (
				ms: MetricKey[],
				keys: string[],
				row: PlausibleResult
			): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of ms) {
					const raw = row.metrics[keys.indexOf(METRIC_MAP[m] as string)]
					if (m === 'revenue') {
						const amount = revenueAmount(raw)
						if (amount !== undefined) {
							out.revenue = amount
						}
						continue
					}
					out[m] = toContractValue(m, typeof raw === 'number' ? raw : 0)
				}
				return out
			}

			const postQuery = (
				metrics: string[],
				clauses: Array<[string, string, string[]]>,
				extra: Record<string, unknown>
			): Promise<PlausibleResponse> =>
				fetchJson<PlausibleResponse>(`${host}/api/v2/query`, {
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: {
						site_id: config.siteId,
						metrics,
						date_range: [
							zonedCalendarDay(q.dateRange.start, q.timezone ?? DEFAULT_TIMEZONE),
							zonedCalendarDay(q.dateRange.end, q.timezone ?? DEFAULT_TIMEZONE),
						],
						...(clauses.length ? { filters: clauses } : {}),
						...extra,
					},
					signal: ctx.signal,
					provider: 'plausible',
				})

			const keyedRows = (
				response: PlausibleResponse | undefined,
				ms: MetricKey[],
				keys: string[]
			): GoalKeyedRow[] | undefined =>
				response?.results.map((row) => ({
					keys: row.dimensions,
					metrics: readMetrics(ms, keys, row),
				}))

			/**
			 * One request shape read twice, plainly and goal-filtered, unioned per row. A row the
			 * goal read has no counterpart for carries no conversions: no goal was completed there.
			 */
			const readPair = async (extra: Record<string, unknown>): Promise<GoalKeyedRow[]> => {
				const pair = await readGoalPair({
					site: siteKeys.length ? () => postQuery(siteKeys, siteFilters, extra) : undefined,
					goals: goalKeys.length ? () => postQuery(goalKeys, goalFilters, extra) : undefined,
				})
				if (pair.failed) {
					goalsFailed = true
				}
				return mergeGoalRows(
					keyedRows(pair.site, siteMetrics, siteKeys),
					keyedRows(pair.goals, goalMetrics, goalKeys)
				)
			}

			if (q.granularity === 'day' && !dims.length) {
				const [series, totalRows] = await Promise.all([
					readPair({ dimensions: ['time:day'] }),
					readPair({}),
				])
				const rows: AnalyticsRow[] = []
				for (const row of series) {
					const ts = dayIso(row.keys[0] ?? '')
					if (ts) {
						rows.push({ timestamp: ts, metrics: row.metrics })
					}
				}
				return { rows, totals: totalRows[0]?.metrics ?? {}, meta: meta() }
			}

			if (!dims.length) {
				const totals = (await readPair({}))[0]?.metrics ?? {}
				return { rows: [{ metrics: totals }], totals, meta: meta() }
			}

			const merged = await readPair({ dimensions: dims.map((d) => DIMENSION_MAP[d] as string) })
			const rows: AnalyticsRow[] = merged.map((row) => {
				const dimValues: Partial<Record<DimensionKey, string>> = {}
				for (let i = 0; i < dims.length; i++) {
					const d = dims[i]
					if (d !== undefined) {
						dimValues[d] = row.keys[i] ?? ''
					}
				}
				return { dimensions: dimValues, metrics: row.metrics }
			})
			return { rows, totals: undefined, meta: meta() }
		},
	}
}
