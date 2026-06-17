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

export interface PlausibleConfig {
	siteId: string
	apiKey: string
	/** Base URL for self-hosted CE. Defaults to Plausible Cloud. */
	host?: string
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

const metrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
const dimensions: ReadonlySet<DimensionKey> = new Set(Object.keys(DIMENSION_MAP) as DimensionKey[])

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	rateLimit: { requestsPerHour: 600 },
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

interface PlausibleResponse {
	results: Array<{ metrics: number[]; dimensions: string[] }>
}

// visit_duration is reported in seconds; the contract avgDuration is milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number =>
	metric === 'avgDuration' ? Math.round(raw * 1000) : raw

export function plausible(config: PlausibleConfig): AnalyticsAdapter {
	const host = config.host ?? 'https://plausible.io'

	return {
		id: 'plausible',
		label: 'Plausible',
		capabilities,
		isConfigured: () => Boolean(config.siteId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const wanted = q.metrics.filter((m) => METRIC_MAP[m])
			const plausibleMetrics = wanted.map((m) => METRIC_MAP[m] as string)
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const filters: Array<[string, string, string[]]> = []
			if (q.path) {
				filters.push(['is', 'event:page', [q.path]])
			}
			const body = {
				site_id: config.siteId,
				metrics: plausibleMetrics,
				date_range: [q.dateRange.start.toISOString(), q.dateRange.end.toISOString()],
				...(dims.length ? { dimensions: dims.map((d) => DIMENSION_MAP[d] as string) } : {}),
				...(filters.length ? { filters } : {}),
			}
			const data = await fetchJson<PlausibleResponse>(`${host}/api/v2/query`, {
				method: 'POST',
				headers: { authorization: `Bearer ${config.apiKey}` },
				body,
				signal: ctx.signal,
				provider: 'plausible',
			})
			const readRow = (row: { metrics: number[] }): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (let i = 0; i < wanted.length; i++) {
					const m = wanted[i]
					if (m !== undefined) {
						out[m] = toContractValue(m, row.metrics[i] ?? 0)
					}
				}
				return out
			}
			if (!dims.length) {
				const totals = data.results[0] ? readRow(data.results[0]) : {}
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'plausible', fetchedAt } }
			}
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
