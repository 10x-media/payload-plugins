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
}

const CLOUD_BASE = 'https://api.umami.is/v1'

const metrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'avgDuration',
])
const dimensions: ReadonlySet<DimensionKey> = new Set<DimensionKey>(['page'])

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

interface UmamiStats {
	pageviews: number
	visitors: number
	visits: number
	bounces: number
	totaltime: number
}

export function umami(config: UmamiConfig): AnalyticsAdapter {
	const base = config.host ?? CLOUD_BASE
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
				bounceRate: stats.visits > 0 ? Math.round((stats.bounces / stats.visits) * 100) : 0,
				avgDuration: stats.visits > 0 ? Math.round((stats.totaltime / stats.visits) * 1000) : 0,
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
