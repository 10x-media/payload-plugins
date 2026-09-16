import type { CaptureSupport } from '../../core/capture'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DimensionKey,
	FilterOperator,
	MetricKey,
} from '../../core/contract'
import { fetchJson } from '../http/fetchJson'
import { dayIso } from '../series'

export interface UmamiConfig {
	websiteId: string
	/** Umami Cloud API key (sent as x-umami-api-key). */
	apiKey?: string
	/** Self-hosted bearer token (from POST /api/auth/login). */
	token?: string
	/**
	 * API base URL. Defaults to Umami Cloud (https://api.umami.is/v1). Self-hosted is
	 * e.g. https://site/api. Capture derives the app origin from this (a trailing `/api`
	 * is stripped), so one `host` value serves both the Stats API and the tracker.
	 */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
}

const CLOUD_BASE = 'https://api.umami.is/v1'
const CLOUD_SCRIPT = 'https://cloud.umami.is/script.js'
const CLOUD_SEND = 'https://gateway.umami.is/api/send'

function buildCapture(config: UmamiConfig): CaptureSupport {
	const origin = config.host ? config.host.replace(/\/api\/?$/, '').replace(/\/+$/, '') : null
	const scriptUpstream = origin ? `${origin}/script.js` : CLOUD_SCRIPT
	const sendUpstream = origin ? `${origin}/api/send` : CLOUD_SEND
	return {
		proxy: {
			routes: [
				{ source: '/script.js', upstream: scriptUpstream },
				{ source: '/api/send', upstream: sendUpstream },
			],
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
	}
}

const umamiMetrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'avgDuration',
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
 * Umami's `re.` is `~*`: a case-insensitive partial match, so an unanchored pattern hits
 * anywhere in the value. `c.` is `ilike`, also case-insensitive.
 */
const OPERATOR_PREFIX: Record<FilterOperator, string> = {
	eq: 'eq.',
	contains: 'c.',
	matches: 're.',
}

const umamiFilters: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)

// `event` is filterable but not a group: /metrics counts event occurrences for it, and the
// adapter cannot declare `events` as a metric because /stats reports no such number.
const umamiDimensions: ReadonlySet<DimensionKey> = new Set(
	[...umamiFilters].filter((dimension) => dimension !== 'event')
)

interface UmamiParams {
	search: URLSearchParams
	/** Filters a one-value-per-param request could not carry. */
	unapplied: AnalyticsFilter[]
	/** Two `eq` values on one param: the AND matches nothing, so the read serves no rows. */
	empty: boolean
}

interface UmamiStats {
	pageviews: number
	visitors: number
	visits: number
	bounces: number
	totaltime: number
}

/**
 * Targets Umami 3.x (cloud and self-hosted): filter values carry an operator prefix, and
 * `eq.` is always written explicitly. Umami parses any of `eq`, `neq`, `c`, `dnc`, `re`,
 * `nre`, `s`, `ns`, `t`, `f`, `gt`, `lt`, `gte`, `lte`, `bf` and `af` followed by a dot as
 * the operator, so a bare value beginning with one (`s.example.com`) would change meaning;
 * written as `eq.s.example.com` it stays a literal. Umami splits an `eq.` value on commas
 * into a value list, with no escape.
 */
export function umami(config: UmamiConfig): AnalyticsAdapter {
	const base = config.host ?? CLOUD_BASE
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: umamiMetrics,
		dimensions: umamiDimensions,
		filters: umamiFilters,
		filterOperators: new Set(['eq', 'contains', 'matches']),
		batchPageReport: true,
		rateLimit: null,
		recommendedTtl: { realtime: 300, aggregate: 3600 },
	}
	// Cloud authenticates with x-umami-api-key; self-hosted with a bearer token.
	const authHeaders = (): Record<string, string> =>
		config.apiKey
			? { 'x-umami-api-key': config.apiKey }
			: config.token
				? { authorization: `Bearer ${config.token}` }
				: {}

	/**
	 * Umami takes one value per query param, so filters that land on the same param cannot
	 * all be sent. Two `eq` values on one param are an AND that matches nothing, which the
	 * read answers as empty without calling the API; anything else keeps the first filter,
	 * except that `q.path` always wins the `path` param so a per-page read stays scoped to
	 * its page. Whatever was dropped travels back in `meta.unappliedFilters`.
	 */
	const params = (q: AnalyticsQuery): UmamiParams => {
		const p = new URLSearchParams({
			startAt: String(q.dateRange.start.getTime()),
			endAt: String(q.dateRange.end.getTime()),
		})
		const unapplied: AnalyticsFilter[] = []
		const eqValues = new Map<string, string>()
		for (const filter of q.filters ?? []) {
			const mapped = DIMENSION_MAP[filter.dimension]
			if (!mapped || filter.operator !== 'eq') {
				continue
			}
			const held = eqValues.get(mapped.param)
			if (held !== undefined && held !== filter.value) {
				return { search: p, unapplied, empty: true }
			}
			eqValues.set(mapped.param, filter.value)
		}
		const held = new Map<string, { value: string; filter: AnalyticsFilter }>()
		for (const filter of q.filters ?? []) {
			const mapped = DIMENSION_MAP[filter.dimension]
			if (!mapped) {
				continue
			}
			const value = `${OPERATOR_PREFIX[filter.operator]}${filter.value}`
			const first = held.get(mapped.param)
			if (first === undefined) {
				held.set(mapped.param, { value, filter })
				p.set(mapped.param, value)
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
			p.set('path', value)
		}
		return { search: p, unapplied, empty: false }
	}

	return {
		id: 'umami',
		label: 'Umami',
		capabilities,
		capture: buildCapture(config),
		isConfigured: () => Boolean(config.websiteId && (config.apiKey || config.token)),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const headers = authHeaders()
			const plan = params(q)
			const meta: AnalyticsResult['meta'] = {
				provider: 'umami',
				fetchedAt,
				...(plan.unapplied.length > 0 ? { unappliedFilters: plan.unapplied } : {}),
			}
			// Totals are left undefined rather than zeroed, the same as every other number this
			// adapter cannot report, so the display layer shows "no data" instead of a real 0.
			if (plan.empty) {
				return { rows: [], totals: undefined, meta }
			}
			const search = (): URLSearchParams => new URLSearchParams(plan.search)

			let breakdown: ({ dimension: DimensionKey } & UmamiDimension) | undefined
			for (const dimension of q.dimensions ?? []) {
				const mapped = DIMENSION_MAP[dimension]
				if (mapped) {
					breakdown = { dimension, ...mapped }
					break
				}
			}

			if (breakdown) {
				const { dimension, param, metric } = breakdown
				const p = search()
				p.set('type', param)
				const data = await fetchJson<Array<{ x: string; y: number }>>(
					`${base}/websites/${config.websiteId}/metrics?${p.toString()}`,
					{ headers, signal: ctx.signal, provider: 'umami' }
				)
				// /metrics reports exactly one number per row, and rows always carry it under the
				// name it actually holds. A requested metric Umami has no per-row source for is
				// absent rather than labelled with a number it is not.
				const rows: AnalyticsRow[] = data.map((row) => ({
					dimensions: { [dimension]: row.x },
					metrics: { [metric]: row.y },
				}))
				return { rows, totals: undefined, meta }
			}

			const fetchTotals = async (): Promise<Partial<Record<MetricKey, number>>> => {
				const stats = await fetchJson<UmamiStats>(
					`${base}/websites/${config.websiteId}/stats?${search().toString()}`,
					{ headers, signal: ctx.signal, provider: 'umami' }
				)
				const all: Partial<Record<MetricKey, number>> = {
					pageviews: stats.pageviews,
					visitors: stats.visitors,
					visits: stats.visits,
					sessions: stats.visits,
					// Derived ratios are omitted (not zeroed) when there are no visits, so the
					// display layer shows a "no data" state instead of a misleading 0.
					bounceRate:
						stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 100) : undefined,
					avgDuration:
						stats.visits > 0 ? Math.round((stats.totaltime / stats.visits) * 1000) : undefined,
				}
				const totals: Partial<Record<MetricKey, number>> = {}
				for (const m of q.metrics) {
					if (all[m] !== undefined) {
						totals[m] = all[m]
					}
				}
				return totals
			}

			// Umami's only time-series endpoint reports pageviews and sessions per interval;
			// visitors/bounceRate/avgDuration have no per-day source, so a trend on those
			// metrics keeps a correct headline (from /stats) but an empty series.
			if (q.granularity === 'day') {
				const p = search()
				p.set('unit', 'day')
				p.set('timezone', q.timezone ?? 'UTC')
				const fetchSeries = () =>
					fetchJson<{
						pageviews: Array<{ x: string; y: number }>
						sessions: Array<{ x: string; y: number }>
					}>(`${base}/websites/${config.websiteId}/pageviews?${p.toString()}`, {
						headers,
						signal: ctx.signal,
						provider: 'umami',
					})
				const [series, totals] = await Promise.all([fetchSeries(), fetchTotals()])
				const sessionsByX = new Map(series.sessions.map((s) => [s.x, s.y]))
				const rows: AnalyticsRow[] = []
				for (const pv of series.pageviews) {
					const ts = dayIso(pv.x)
					if (!ts) {
						continue
					}
					const dayMetrics = sessionsByX.get(pv.x) ?? 0
					const all: Partial<Record<MetricKey, number>> = {
						pageviews: pv.y,
						visits: dayMetrics,
						sessions: dayMetrics,
					}
					const metrics: Partial<Record<MetricKey, number>> = {}
					for (const m of q.metrics) {
						if (all[m] !== undefined) {
							metrics[m] = all[m]
						}
					}
					rows.push({ timestamp: ts, metrics })
				}
				return { rows, totals, meta }
			}

			const totals = await fetchTotals()
			return { rows: [{ metrics: totals }], totals, meta }
		},
	}
}
