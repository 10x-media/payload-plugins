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

export interface PosthogConfig {
	/** PostHog project id (numeric). */
	projectId: string
	/** Personal API key with the "Query Read" scope (phx_...). */
	apiKey: string
	/** API host. Defaults to US Cloud; EU is https://eu.posthog.com, self-host is your instance URL. */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
}

const US_CLOUD = 'https://us.posthog.com'

// visits and sessions share the distinct-session expression and are deduped before
// the SELECT, then read back by the expression's position.
const METRIC_SQL: Partial<Record<MetricKey, string>> = {
	pageviews: 'count()',
	visitors: 'count(DISTINCT person_id)',
	visits: 'count(DISTINCT properties.$session_id)',
	sessions: 'count(DISTINCT properties.$session_id)',
}

const posthogMetrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_SQL) as MetricKey[])
const posthogDimensions: ReadonlySet<DimensionKey> = new Set<DimensionKey>(['page'])

// The Query API has no parameter binding, so values are inlined as quoted literals.
// Escape backslashes first, then single quotes, so a crafted path cannot break out.
const sqlString = (value: string): string =>
	`'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const sqlDateTimeLiteral = (d: Date): string =>
	sqlString(d.toISOString().slice(0, 19).replace('T', ' '))

interface PosthogQueryResponse {
	columns: string[]
	types: string[]
	results: unknown[][]
}

export function posthog(config: PosthogConfig): AnalyticsAdapter {
	const host = config.host ?? US_CLOUD
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		comparison: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: posthogMetrics,
		dimensions: posthogDimensions,
		batchPageReport: true,
		rateLimit: { requestsPerMinute: 240, requestsPerHour: 2400 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
	}

	return {
		id: 'posthog',
		label: 'PostHog',
		capabilities,
		isConfigured: () => Boolean(config.projectId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const wanted = q.metrics.filter((m) => METRIC_SQL[m])
			const exprs = [...new Set(wanted.map((m) => METRIC_SQL[m] as string))]
			const wantsPageBreakdown = (q.dimensions ?? []).includes('page')

			const where = [
				"event = '$pageview'",
				`timestamp >= toDateTime(${sqlDateTimeLiteral(q.dateRange.start)})`,
				`timestamp <= toDateTime(${sqlDateTimeLiteral(q.dateRange.end)})`,
			]
			if (q.path) {
				where.push(`properties.$pathname = ${sqlString(q.path)}`)
			}

			const selectMetrics = exprs.map((expr, i) => `${expr} AS m${i}`)
			const sql = wantsPageBreakdown
				? `SELECT properties.$pathname AS path, ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')} GROUP BY path ORDER BY m0 DESC LIMIT ${q.limit ?? 100}`
				: `SELECT ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')}`

			const data = await fetchJson<PosthogQueryResponse>(
				`${host}/api/projects/${config.projectId}/query/`,
				{
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: { query: { kind: 'HogQLQuery', query: sql } },
					signal: ctx.signal,
					provider: 'posthog',
				}
			)

			const readRow = (row: unknown[], offset: number): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of wanted) {
					const idx = exprs.indexOf(METRIC_SQL[m] as string)
					out[m] = Number(row[offset + idx] ?? 0)
				}
				return out
			}

			if (!wantsPageBreakdown) {
				const row = data.results[0]
				const totals = row ? readRow(row, 0) : {}
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'posthog', fetchedAt } }
			}

			const rows: AnalyticsRow[] = data.results.map((row) => ({
				dimensions: { page: String(row[0] ?? '') },
				metrics: readRow(row, 1),
			}))
			return { rows, totals: undefined, meta: { provider: 'posthog', fetchedAt } }
		},
	}
}
