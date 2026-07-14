import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DimensionKey,
	MetricKey,
} from '../../core/contract'
import { fetchJson } from '../http/fetchJson'
import { dayIso } from '../series'

export interface PlausibleConfig {
	siteId: string
	apiKey: string
	/** Base URL for self-hosted CE. Defaults to Plausible Cloud. */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
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
	revenue: 'total_revenue',
}

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
}

const plausibleMetrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
const plausibleDimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)

interface PlausibleResponse {
	results: Array<{ metrics: number[]; dimensions: string[] }>
}

// visit_duration is reported in seconds; the contract avgDuration is milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number =>
	metric === 'avgDuration' ? Math.round(raw * 1000) : raw

export function plausible(config: PlausibleConfig): AnalyticsAdapter {
	const host = config.host ?? 'https://plausible.io'
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		comparison: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: plausibleMetrics,
		dimensions: plausibleDimensions,
		batchPageReport: true,
		rateLimit: { requestsPerHour: 600 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
	}

	return {
		id: 'plausible',
		label: 'Plausible',
		capabilities,
		isConfigured: () => Boolean(config.siteId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const wanted = q.metrics.filter((m) => METRIC_MAP[m])
			// Several contract metrics alias one Plausible metric (sessions and visits both
			// map to "visits"), so dedupe before sending and read each contract metric back
			// from its provider key's position rather than the request index.
			const providerMetrics = [...new Set(wanted.map((m) => METRIC_MAP[m] as string))]
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const filters: Array<[string, string, string[]]> = []
			if (q.path) {
				filters.push(['is', 'event:page', [q.path]])
			}
			if (q.hostname) {
				filters.push(['is', 'event:hostname', [q.hostname]])
			}

			const readRow = (row: { metrics: number[] }): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of wanted) {
					const idx = providerMetrics.indexOf(METRIC_MAP[m] as string)
					out[m] = toContractValue(m, row.metrics[idx] ?? 0)
				}
				return out
			}

			const postQuery = (extra: Record<string, unknown>): Promise<PlausibleResponse> =>
				fetchJson<PlausibleResponse>(`${host}/api/v2/query`, {
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: {
						site_id: config.siteId,
						metrics: providerMetrics,
						date_range: [
							q.dateRange.start.toISOString().slice(0, 10),
							q.dateRange.end.toISOString().slice(0, 10),
						],
						...(filters.length ? { filters } : {}),
						...extra,
					},
					signal: ctx.signal,
					provider: 'plausible',
				})

			const fetchTotals = async (): Promise<Partial<Record<MetricKey, number>>> => {
				const data = await postQuery({})
				return data.results[0] ? readRow(data.results[0]) : {}
			}

			if (q.granularity === 'day' && !dims.length) {
				const [seriesData, totals] = await Promise.all([
					postQuery({ dimensions: ['time:day'] }),
					fetchTotals(),
				])
				const rows: AnalyticsRow[] = []
				for (const row of seriesData.results) {
					const ts = dayIso(row.dimensions[0] ?? '')
					if (ts) {
						rows.push({ timestamp: ts, metrics: readRow(row) })
					}
				}
				return { rows, totals, meta: { provider: 'plausible', fetchedAt } }
			}

			if (!dims.length) {
				const totals = await fetchTotals()
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'plausible', fetchedAt } }
			}

			const data = await postQuery({ dimensions: dims.map((d) => DIMENSION_MAP[d] as string) })
			const rows: AnalyticsRow[] = data.results.map((row) => {
				const dimValues: Partial<Record<DimensionKey, string>> = {}
				for (let i = 0; i < dims.length; i++) {
					const d = dims[i]
					if (d !== undefined) {
						dimValues[d] = row.dimensions[i] ?? ''
					}
				}
				return { dimensions: dimValues, metrics: readRow(row) }
			})
			return { rows, totals: undefined, meta: { provider: 'plausible', fetchedAt } }
		},
	}
}
