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

// Contract dimension -> Umami filter param, which doubles as the /metrics `type` value.
const DIMENSION_MAP: Partial<Record<DimensionKey, string>> = {
	page: 'path',
	referrer: 'referrer',
	browser: 'browser',
	os: 'os',
	device: 'device',
	country: 'country',
	region: 'region',
	city: 'city',
	language: 'language',
	event: 'event',
	utmSource: 'utmSource',
	utmMedium: 'utmMedium',
	utmCampaign: 'utmCampaign',
	utmContent: 'utmContent',
	utmTerm: 'utmTerm',
}

const OPERATOR_PREFIX: Record<FilterOperator, string> = {
	eq: 'eq.',
	contains: 'c.',
	matches: 're.',
}

const umamiDimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)

interface UmamiStats {
	pageviews: number
	visitors: number
	visits: number
	bounces: number
	totaltime: number
}

/**
 * Targets Umami 3.x (cloud and self-hosted): filter values carry an operator prefix, and
 * `eq.` is always written explicitly so a value starting with `c.` or `re.` is not read as
 * an operator. Umami splits an `eq.` value on commas into a value list, with no escape.
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
		filters: umamiDimensions,
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

	const params = (q: AnalyticsQuery): URLSearchParams => {
		const p = new URLSearchParams({
			startAt: String(q.dateRange.start.getTime()),
			endAt: String(q.dateRange.end.getTime()),
		})
		for (const filter of q.filters ?? []) {
			const param = DIMENSION_MAP[filter.dimension]
			if (param) {
				p.set(param, `${OPERATOR_PREFIX[filter.operator]}${filter.value}`)
			}
		}
		// Written last: Umami takes one value per param, so a per-page read stays scoped to
		// its page even when the caller also filters on `page`.
		if (q.path) {
			p.set('path', `eq.${q.path}`)
		}
		return p
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
			const breakdownDim = (q.dimensions ?? []).find((d) => DIMENSION_MAP[d])

			if (breakdownDim) {
				const p = params(q)
				p.set('type', DIMENSION_MAP[breakdownDim] as string)
				const data = await fetchJson<Array<{ x: string; y: number }>>(
					`${base}/websites/${config.websiteId}/metrics?${p.toString()}`,
					{ headers, signal: ctx.signal, provider: 'umami' }
				)
				// /metrics reports exactly one number per row: distinct sessions (visitors) on
				// pageview-type rows, and event occurrences on `type=event` rows. Any other
				// requested metric is omitted rather than labelled with a number it is not.
				const available: MetricKey = breakdownDim === 'event' ? 'events' : 'visitors'
				const rows: AnalyticsRow[] = data.map((row) => {
					const dimensions: Partial<Record<DimensionKey, string>> = { [breakdownDim]: row.x }
					const metrics: Partial<Record<MetricKey, number>> = q.metrics.includes(available)
						? { [available]: row.y }
						: {}
					return { dimensions, metrics }
				})
				return { rows, totals: undefined, meta: { provider: 'umami', fetchedAt } }
			}

			const fetchTotals = async (): Promise<Partial<Record<MetricKey, number>>> => {
				const stats = await fetchJson<UmamiStats>(
					`${base}/websites/${config.websiteId}/stats?${params(q).toString()}`,
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
				const p = params(q)
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
				return { rows, totals, meta: { provider: 'umami', fetchedAt } }
			}

			const totals = await fetchTotals()
			return { rows: [{ metrics: totals }], totals, meta: { provider: 'umami', fetchedAt } }
		},
	}
}
