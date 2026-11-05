import {
	adapterWithoutConsent,
	cookielessCapture,
	WITHOUT_CONSENT_LEVELS,
} from '../../capture/withoutConsent'
import { filterableDimensions } from '../../core/capabilities'
import type { CaptureSupport } from '../../core/capture'
import {
	type AdapterContext,
	type AnalyticsAdapter,
	type AnalyticsCapabilities,
	type AnalyticsFilter,
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
import { type AdapterLabelOption, adapterLabel } from '../../core/sourceLabel'
import { DEFAULT_TIMEZONE } from '../../timeframe/tz'
import type { WithoutConsentLevel } from '../../tracker/config'
import { emptyGoalBreakdown, goalHint, hintFailed, hintSlugs } from '../goalRead'
import { hostnameOf, withoutTrailingSlash } from '../http/baseUrl'
import { declaredFilters, everyOperatorOn, firstMapped, mappedKeys } from '../mapping'
import { readTime } from '../readTime'
import { dayIso } from '../series'
import { upstreamJson } from '../upstream'

export interface UmamiConfig {
	/**
	 * The source's name in pickers and listings: a string, a map by admin language (read like
	 * `view.navLabel`), or a function naming it per reader and scope. Default `'Umami'`.
	 */
	label?: AdapterLabelOption
	websiteId: string
	/** Umami Cloud API key (sent as x-umami-api-key). */
	apiKey?: string
	/** Self-hosted bearer token (from POST /api/auth/login). */
	token?: string
	/**
	 * The self-hosted Umami app's address, base path included (`https://example.com/umami`), whose
	 * API is read under `/api`; a trailing `/api` is dropped. Unset, or Umami Cloud's, reads the cloud.
	 */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/** The fetch reads and the capture proxy reach Umami with. Unset, the global fetch. */
	fetch?: FetchLike
	/**
	 * What this source's held slot does without consent, over `capture.withoutConsent`. Umami stores
	 * nothing on the device, so `'cookieless'` loads the script as it is; `'off'` holds it.
	 */
	withoutConsent?: WithoutConsentLevel
}

/** Where one Umami install answers: its Stats API, its tracker script, and its event sink. */
export interface UmamiEndpoints {
	api: string
	script: string
	send: string
}

const CLOUD: UmamiEndpoints = {
	api: 'https://api.umami.is/v1',
	script: 'https://cloud.umami.is/script.js',
	send: 'https://gateway.umami.is/api/send',
}

/** Umami Cloud's own hosts, which mean the cloud rather than an app address under them. */
const CLOUD_HOSTNAMES: ReadonlySet<string> = new Set(['api.umami.is', 'cloud.umami.is'])

/**
 * The endpoints `host` names: the cloud for nothing or for Umami Cloud's own address, otherwise
 * the app address (trailing slashes and a trailing `/api` dropped) with the API under `/api`.
 */
export const umamiEndpoints = (host: string | undefined): UmamiEndpoints => {
	const trimmed = withoutTrailingSlash(host?.trim() ?? '')
	const address = withoutTrailingSlash(trimmed.replace(/\/api$/, ''))
	if (address === '' || CLOUD_HOSTNAMES.has(hostnameOf(address))) {
		return CLOUD
	}
	return { api: `${address}/api`, script: `${address}/script.js`, send: `${address}/api/send` }
}

function buildCapture(config: UmamiConfig, endpoints: UmamiEndpoints): CaptureSupport {
	return {
		proxy: {
			routes: [
				{ source: '/script.js', upstream: endpoints.script, kind: 'script' },
				{ source: '/api/send', upstream: endpoints.send, kind: 'data' },
			],
			...(config.fetch ? { fetch: config.fetch } : {}),
		},
		snippet: ({ path }) => ({
			scripts: [
				{
					src: `${path}/script.js`,
					defer: true,
					attrs: { 'data-website-id': config.websiteId, 'data-host-url': path },
				},
			],
		}),
		client: { kind: 'umami' },
		...cookielessCapture(
			{ kind: 'inherent' },
			adapterWithoutConsent(
				config.withoutConsent,
				'umami({ withoutConsent })',
				WITHOUT_CONSENT_LEVELS
			)
		),
	}
}

const umamiMetrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'visitDuration',
	'conversions',
])

interface UmamiDimension {
	/** Umami filter param, which doubles as the /metrics `type` value. */
	param: string
	/** The one metric /metrics reports for this type: y is nothing else. */
	metric: MetricKey
}

// y is count(distinct session_id) on every pageview and session type, and event
// occurrences on `type=event`.
const DIMENSION_MAP: Partial<Record<DimensionKey, UmamiDimension>> = {
	page: { param: 'path', metric: 'visitors' },
	referrer: { param: 'referrer', metric: 'visitors' },
	browser: { param: 'browser', metric: 'visitors' },
	os: { param: 'os', metric: 'visitors' },
	device: { param: 'device', metric: 'visitors' },
	country: { param: 'country', metric: 'visitors' },
	region: { param: 'region', metric: 'visitors' },
	city: { param: 'city', metric: 'visitors' },
	language: { param: 'language', metric: 'visitors' },
	event: { param: 'event', metric: 'events' },
	utmSource: { param: 'utmSource', metric: 'visitors' },
	utmMedium: { param: 'utmMedium', metric: 'visitors' },
	utmCampaign: { param: 'utmCampaign', metric: 'visitors' },
	utmContent: { param: 'utmContent', metric: 'visitors' },
	utmTerm: { param: 'utmTerm', metric: 'visitors' },
}

/**
 * Goals are custom events, so a goal's slug must equal the captured event's name. Only this shape
 * answers `conversions`: other breakdowns and the daily series report none.
 */
const GOAL_DIMENSION: UmamiDimension = { param: 'event', metric: 'conversions' }

/**
 * The /metrics types a read groups by. `channel` is Umami's acquisition classification, a type
 * with no filter param, which is why it sits outside {@link DIMENSION_MAP}.
 */
const BREAKDOWNS: Partial<Record<DimensionKey, UmamiDimension>> = {
	...DIMENSION_MAP,
	channel: { param: 'channel', metric: 'visitors' },
}

/**
 * Umami's `re.` is `~*`: a case-insensitive partial match, so an unanchored pattern hits
 * anywhere in the value. `c.` is `ilike`, also case-insensitive.
 */
const OPERATOR_PREFIX: Record<FilterOperator, string> = {
	eq: 'eq.',
	contains: 'c.',
	matches: 're.',
}

/** A filter as its param value, always prefixed so a value starting like an operator stays literal. */
const paramValue = (filter: AnalyticsFilter): string =>
	`${OPERATOR_PREFIX[filter.operator]}${filter.value}`

/**
 * Every filter param takes equals, contains and a regular expression
 * (https://docs.umami.is/docs/filters), written as the `eq.`, `c.` and `re.` prefixes.
 */
const umamiFilters = everyOperatorOn(mappedKeys(DIMENSION_KEYS, DIMENSION_MAP))

// `event` filters but does not group, since /stats reports no `events` number to declare;
// `goal` and `channel` are the reverse, /metrics types with no matching filter param.
const umamiDimensions: ReadonlySet<DimensionKey> = new Set<DimensionKey>([
	...filterableDimensions({ filters: umamiFilters }).filter((dimension) => dimension !== 'event'),
	'goal',
	'channel',
])

/**
 * /stats answers site totals and /metrics one count per row, so other metrics are site-wide only.
 * Nothing reports time per pageview, so no time on page is offered.
 */
const siteOnly: MetricReach = { dimensions: [] }
const umamiReach: Partial<Record<MetricKey, MetricReach>> = {
	pageviews: siteOnly,
	visits: siteOnly,
	sessions: siteOnly,
	bounceRate: siteOnly,
	visitDuration: siteOnly,
	visitors: { dimensions: [...umamiDimensions].filter((dimension) => dimension !== 'goal') },
	conversions: { dimensions: ['goal'] },
}

interface UmamiParams {
	search: URLSearchParams
	/** Filters a one-value-per-param request could not carry. */
	unapplied: AnalyticsFilter[]
	/** Two `eq` values on one param: the AND matches nothing, so the read serves no rows. */
	empty: boolean
}

/**
 * The read's range and filters as query params, one value per param: clashing `eq` values match
 * nothing (an empty read), and other clashes keep the first, the page path always winning.
 */
const paramsFor = (q: AnalyticsQuery): UmamiParams => {
	const search = new URLSearchParams({
		startAt: String(q.dateRange.start.getTime()),
		endAt: String(q.dateRange.end.getTime()),
	})
	const filters = declaredFilters({ filters: umamiFilters }, q.filters, DIMENSION_MAP)
	const eqValues = new Map<string, string>()
	for (const { filter, field } of filters) {
		if (filter.operator !== 'eq') {
			continue
		}
		const held = eqValues.get(field.param)
		if (held !== undefined && held !== filter.value) {
			return { search, unapplied: [], empty: true }
		}
		eqValues.set(field.param, filter.value)
	}
	const unapplied: AnalyticsFilter[] = []
	const held = new Map<string, { value: string; filter: AnalyticsFilter }>()
	for (const { filter, field } of filters) {
		// Umami splits an `eq.` value on commas with no escape, which would widen the question.
		if (filter.operator === 'eq' && filter.value.includes(',')) {
			unapplied.push(filter)
			continue
		}
		const value = paramValue(filter)
		const first = held.get(field.param)
		if (first === undefined) {
			held.set(field.param, { value, filter })
			search.set(field.param, value)
		} else if (first.value !== value) {
			unapplied.push(filter)
		}
	}
	if (q.path) {
		const value = `eq.${q.path}`
		const first = held.get('path')
		if (first !== undefined && first.value !== value) {
			unapplied.push(first.filter)
		}
		search.set('path', value)
	}
	return { search, unapplied, empty: false }
}

/** `values` narrowed to the metrics a read asked for. */
const requested = (metrics: readonly MetricKey[], values: MetricValues): MetricValues => {
	const out: MetricValues = {}
	for (const metric of metrics) {
		if (values[metric] !== undefined) {
			out[metric] = values[metric]
		}
	}
	return out
}

interface UmamiPoint {
	x: string
	y: number
}

interface UmamiSeries {
	pageviews: UmamiPoint[]
	sessions: UmamiPoint[]
}

interface UmamiStats {
	pageviews: number
	visitors: number
	visits: number
	bounces: number
	totaltime: number
}

/**
 * The Umami 3.x adapter, cloud and self-hosted. Filter values always carry an explicit `eq.` prefix,
 * so a value starting like an operator is never read as one.
 */
export function umami(config: UmamiConfig): AnalyticsAdapter {
	const endpoints = umamiEndpoints(config.host)
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730

	const capabilities: AnalyticsCapabilities = {
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: umamiMetrics,
		dimensions: umamiDimensions,
		metricReach: umamiReach,
		filters: umamiFilters,
		semantics: { visitors: 'distinct', sessions: 'provider' },
		rateLimit: null,
		recommendedTtl: { realtime: 300, aggregate: 3600 },
		upstreamAware: true,
	}
	// Cloud authenticates with x-umami-api-key; self-hosted with a bearer token.
	const authHeaders = (): Record<string, string> =>
		config.apiKey
			? { 'x-umami-api-key': config.apiKey }
			: config.token
				? { authorization: `Bearer ${config.token}` }
				: {}

	return {
		id: 'umami',
		...adapterLabel(config.label, 'Umami', 'umami({ label })'),
		capabilities,
		capture: buildCapture(config, endpoints),
		isConfigured: () => Boolean(config.websiteId && (config.apiKey || config.token)),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = readTime(ctx)
			const headers = authHeaders()
			const goalBreakdown = (q.dimensions ?? []).includes('goal')
			const hint = goalHint(q)
			const slugs = hintSlugs(hint)
			const plan = paramsFor(q)
			const breakdown = firstMapped(q.dimensions, BREAKDOWNS)
			// Umami splits an `eq.` list on commas with no escape, so a slug carrying one is left out
			// and reported rather than widening the read to every event.
			const askable = (slugs ?? []).filter((slug) => !slug.includes(','))
			const unaskable = (slugs ?? []).filter((slug) => slug.includes(','))
			const eventValue = `eq.${askable.join(',')}`
			// Goal rows come from the `event` param, so on a read that fetches them the hint wins and a
			// caller's own event filter is reported unapplied; any other breakdown sends it as written.
			const eventFilter = (q.filters ?? []).find((f) => f.dimension === 'event')
			const readsGoals =
				goalBreakdown || (!breakdown && q.metrics.includes('conversions') && slugs !== null)
			const unapplied: AnalyticsFilter[] = [
				...plan.unapplied,
				...unaskable.map(
					(slug): AnalyticsFilter => ({ dimension: 'goal', operator: 'eq', value: slug })
				),
				...(readsGoals && eventFilter && paramValue(eventFilter) !== eventValue
					? [eventFilter]
					: []),
			]
			const unresolved = q.metrics.includes('conversions') && hintFailed(hint)
			const unappliedMeta = unapplied.length > 0 ? { unappliedFilters: unapplied } : {}
			const empty = goalBreakdown
				? emptyGoalBreakdown({ provider: 'umami', fetchedAt, hint, meta: unappliedMeta })
				: null
			if (empty) {
				return empty
			}
			const meta: AnalyticsResult['meta'] = {
				provider: 'umami',
				fetchedAt,
				...unappliedMeta,
				...(unresolved ? { goalsUnresolved: true as const } : {}),
			}
			// Totals are left undefined rather than zeroed, the same as every other number this
			// adapter cannot report, so the display layer shows "no data" instead of a real 0.
			if (plan.empty) {
				return { rows: [], totals: undefined, meta }
			}

			/** The read's params plus `extra`, on a fresh copy so no request sees another's. */
			const search = (extra: Record<string, string> = {}): URLSearchParams => {
				const params = new URLSearchParams(plan.search)
				for (const [name, value] of Object.entries(extra)) {
					params.set(name, value)
				}
				return params
			}
			const getJson = <T>(endpoint: string, params: URLSearchParams): Promise<T> =>
				upstreamJson<T>(
					ctx,
					`${endpoints.api}/websites/${config.websiteId}/${endpoint}?${params.toString()}`,
					{ headers, provider: 'umami', fetch: config.fetch }
				)

			/**
			 * The goal rows for the hint, narrowed to it again on the way back so nothing the API
			 * did not restrict can arrive as a goal.
			 */
			const fetchGoalRows = async (): Promise<UmamiPoint[]> => {
				if (askable.length === 0) {
					return []
				}
				const data = await getJson<UmamiPoint[]>(
					'metrics',
					search({ type: GOAL_DIMENSION.param, [GOAL_DIMENSION.param]: eventValue })
				)
				const wanted = new Set(askable)
				return data.filter((row) => wanted.has(row.x))
			}

			if (goalBreakdown) {
				const rows: AnalyticsRow[] = (await fetchGoalRows()).map((row) => ({
					dimensions: { goal: row.x },
					metrics: { [GOAL_DIMENSION.metric]: row.y },
				}))
				return { rows, totals: undefined, meta }
			}

			if (breakdown) {
				const { dimension, field } = breakdown
				const data = await getJson<UmamiPoint[]>('metrics', search({ type: field.param }))
				// /metrics reports one number per row, under the name it holds: a requested metric with no
				// per-row source is absent rather than labelled with a number it is not.
				const rows: AnalyticsRow[] = data.map((row) => ({
					dimensions: { [dimension]: row.x },
					metrics: { [field.metric]: row.y },
				}))
				return { rows, totals: undefined, meta }
			}

			const fetchTotals = async (): Promise<MetricValues> => {
				// Conversions have no place in /stats: their total is the goal rows summed.
				const [stats, goalRows] = await Promise.all([
					getJson<UmamiStats>('stats', search()),
					q.metrics.includes('conversions') && slugs ? fetchGoalRows() : undefined,
				])
				return requested(q.metrics, {
					...(goalRows ? { conversions: goalRows.reduce((sum, row) => sum + row.y, 0) } : {}),
					pageviews: stats.pageviews,
					visitors: stats.visitors,
					visits: stats.visits,
					sessions: stats.visits,
					// Derived ratios read null (not zero) when there are no visits: a bounce rate of
					// nobody is no data, and a 0 would read as every visitor staying.
					bounceRate: stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 100) : null,
					visitDuration:
						stats.visits > 0 ? Math.round((stats.totaltime / stats.visits) * 1000) : null,
				})
			}

			// Umami's only series endpoint reports pageviews and sessions, so a trend on any other
			// metric keeps its /stats headline but an empty series.
			if (q.granularity === 'day') {
				const [series, totals] = await Promise.all([
					getJson<UmamiSeries>(
						'pageviews',
						search({ unit: 'day', timezone: q.timezone ?? DEFAULT_TIMEZONE })
					),
					fetchTotals(),
				])
				const sessionsByDay = new Map(series.sessions.map((point) => [point.x, point.y]))
				const rows: AnalyticsRow[] = []
				for (const point of series.pageviews) {
					const timestamp = dayIso(point.x)
					if (!timestamp) {
						continue
					}
					const sessions = sessionsByDay.get(point.x) ?? 0
					rows.push({
						timestamp,
						metrics: requested(q.metrics, { pageviews: point.y, visits: sessions, sessions }),
					})
				}
				return { rows, totals, meta }
			}

			const totals = await fetchTotals()
			return { rows: [{ metrics: totals }], totals, meta }
		},
	}
}
