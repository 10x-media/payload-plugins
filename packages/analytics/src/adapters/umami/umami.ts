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

export interface UmamiConfig {
	websiteId: string
	/** Umami Cloud API key (sent as x-umami-api-key). */
	apiKey?: string
	/** Self-hosted bearer token (from POST /api/auth/login). */
	token?: string
	/** API base URL. Defaults to Umami Cloud (https://api.umami.is/v1). Self-hosted is e.g. https://site/api. */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
}

const CLOUD_BASE = 'https://api.umami.is/v1'

const umamiMetrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'avgDuration',
])
const umamiDimensions: ReadonlySet<DimensionKey> = new Set<DimensionKey>(['page'])

interface UmamiStats {
	pageviews: number
	visitors: number
	visits: number
	bounces: number
	totaltime: number
}

export function umami(config: UmamiConfig): AnalyticsAdapter {
	const base = config.host ?? CLOUD_BASE
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		comparison: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: umamiMetrics,
		dimensions: umamiDimensions,
		batchPageReport: true,
		rateLimit: null,
		recommendedTtl: { realtime: 300, aggregate: 3600 },
	}
	// Cloud authenticates with x-umami-api-key; self-hosted with a bearer token.
	// NOTE: the cloud header name and the per-URL `path` filter (set in params(), also
	// sent to /metrics) match the documented v2 shape but are unvalidated against a live
	// instance; confirm both before relying on per-URL provider data in production.
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
		if (q.path) {
			p.set('path', q.path)
		}
		return p
	}

	return {
		id: 'umami',
		label: 'Umami',
		capabilities,
		isConfigured: () => Boolean(config.websiteId && (config.apiKey || config.token)),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const headers = authHeaders()
			const wantsPageBreakdown = (q.dimensions ?? []).includes('page')

			if (wantsPageBreakdown) {
				const p = params(q)
				p.set('type', 'url')
				const data = await fetchJson<Array<{ x: string; y: number }>>(
					`${base}/websites/${config.websiteId}/metrics?${p.toString()}`,
					{ headers, signal: ctx.signal, provider: 'umami' }
				)
				const metric: MetricKey = q.metrics.includes('pageviews') ? 'pageviews' : 'visitors'
				const rows: AnalyticsRow[] = data.map((row) => ({
					dimensions: { page: row.x },
					metrics: { [metric]: row.y } as Partial<Record<MetricKey, number>>,
				}))
				return { rows, totals: undefined, meta: { provider: 'umami', fetchedAt } }
			}

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
				bounceRate: stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 100) : undefined,
				avgDuration:
					stats.visits > 0 ? Math.round((stats.totaltime / stats.visits) * 1000) : undefined,
			}
			const totals: Partial<Record<MetricKey, number>> = {}
			for (const m of q.metrics) {
				if (all[m] !== undefined) {
					totals[m] = all[m]
				}
			}
			return { rows: [{ metrics: totals }], totals, meta: { provider: 'umami', fetchedAt } }
		},
	}
}
