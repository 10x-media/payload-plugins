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
import { dayIso, hourIso } from '../series'

export interface PosthogConfig {
	/** PostHog project id (numeric). */
	projectId: string
	/** Personal API key with the "Query Read" scope (phx_...). */
	apiKey: string
	/** API host. Defaults to US Cloud; EU is https://eu.posthog.com, self-host is your instance URL. */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/**
	 * Event property holding a query's scope (e.g. 'tenant'). Enables scoped queries:
	 * one platform project captures every scope with this property set, and a scoped
	 * read filters on it. Both the property name and value are escaped literals.
	 */
	scopeProperty?: string
}

const US_CLOUD = 'https://us.posthog.com'

// Pageview-scoped expressions, used when the read filters the WHERE to `$pageview`.
// visits and sessions share the distinct-session expression and are deduped before the
// SELECT, then read back by the expression's position.
const METRIC_SQL_PAGEVIEW: Partial<Record<MetricKey, string>> = {
	pageviews: 'count()',
	visitors: 'count(DISTINCT person_id)',
	visits: 'count(DISTINCT properties.$session_id)',
	sessions: 'count(DISTINCT properties.$session_id)',
}

// All-event expressions, used when `events` (total captured events, matching PostHog's own
// Events definition) or an `event`-name breakdown is requested. The WHERE is not filtered to
// `$pageview`, so the pageview-family metrics scope themselves with conditional aggregates.
const METRIC_SQL_ALL: Partial<Record<MetricKey, string>> = {
	pageviews: "countIf(event = '$pageview')",
	visitors: "count(DISTINCT if(event = '$pageview', person_id, NULL))",
	visits: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	sessions: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	events: 'count()',
}

const DIMENSION_SQL: Partial<Record<DimensionKey, string>> = {
	page: 'properties.$pathname',
	event: 'event',
}

const posthogMetrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_SQL_ALL) as MetricKey[])
const posthogDimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_SQL) as DimensionKey[]
)

// The Query API has no parameter binding, so values are inlined as quoted literals.
// Escape backslashes first, then single quotes, so a crafted path cannot break out.
const sqlString = (value: string): string =>
	`'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// ILIKE treats % and _ as wildcards and backslash as its own escape char; backslash-escape
// backslash first (so a raw \ in the value doesn't get read as escaping the next char),
// then % and _, before the whole thing is wrapped in % ... % and quoted.
const escapeLikeValue = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

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
		minGranularity: 'hour',
		maxLookbackDays,
		metrics: posthogMetrics,
		dimensions: posthogDimensions,
		filters: posthogDimensions,
		filterOperators: new Set(['eq', 'contains', 'matches']),
		batchPageReport: true,
		rateLimit: { requestsPerMinute: 240, requestsPerHour: 2400 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
		...(config.scopeProperty ? { scopedQueries: true } : {}),
	}

	return {
		id: 'posthog',
		label: 'PostHog',
		capabilities,
		isConfigured: () => Boolean(config.projectId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const breakdownDim = (q.dimensions ?? []).find((d) => DIMENSION_SQL[d])
			// A total-events metric, an event-name breakdown, or a filter on the event
			// dimension must scan every event, not just pageviews (a `$pageview` WHERE
			// clause combined with an `event = 'x'` filter would be self-contradictory and
			// zero every metric); those reads switch to conditional aggregation.
			const scanAllEvents =
				q.metrics.includes('events') ||
				breakdownDim === 'event' ||
				(q.filters ?? []).some((f) => f.dimension === 'event' && DIMENSION_SQL[f.dimension])
			const metricSql = scanAllEvents ? METRIC_SQL_ALL : METRIC_SQL_PAGEVIEW
			const wanted = q.metrics.filter((m) => metricSql[m])
			const exprs = [...new Set(wanted.map((m) => metricSql[m] as string))]

			const where = [
				`timestamp >= toDateTime(${sqlDateTimeLiteral(q.dateRange.start)})`,
				`timestamp <= toDateTime(${sqlDateTimeLiteral(q.dateRange.end)})`,
			]
			if (!scanAllEvents) {
				where.unshift("event = '$pageview'")
			}
			if (q.path) {
				where.push(`properties.$pathname = ${sqlString(q.path)}`)
			}
			if (q.hostname) {
				where.push(`properties.$host = ${sqlString(q.hostname)}`)
			}
			if (config.scopeProperty && q.scope !== undefined) {
				// Bracket property access with escaped literals: neither the configured
				// property name nor the scope value can break out of the HogQL string.
				where.push(`properties[${sqlString(config.scopeProperty)}] = ${sqlString(q.scope)}`)
			}
			// Capability gating (filters/filterOperators) is the real contract upstream; an
			// unsupported dimension is dropped here as the safety net so it never throws.
			for (const filter of q.filters ?? []) {
				const expr = DIMENSION_SQL[filter.dimension]
				if (!expr) {
					continue
				}
				if (filter.operator === 'eq') {
					where.push(`${expr} = ${sqlString(filter.value)}`)
				} else if (filter.operator === 'contains') {
					where.push(`${expr} ILIKE ${sqlString(`%${escapeLikeValue(filter.value)}%`)}`)
				} else if (filter.operator === 'matches') {
					where.push(`match(${expr}, ${sqlString(filter.value)})`)
				}
			}
			const selectMetrics = exprs.map((expr, i) => `${expr} AS m${i}`)

			const runSql = (sql: string): Promise<PosthogQueryResponse> =>
				fetchJson<PosthogQueryResponse>(`${host}/api/projects/${config.projectId}/query/`, {
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: { query: { kind: 'HogQLQuery', query: sql } },
					signal: ctx.signal,
					provider: 'posthog',
				})

			const readRow = (row: unknown[], offset: number): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of wanted) {
					const idx = exprs.indexOf(metricSql[m] as string)
					out[m] = Number(row[offset + idx] ?? 0)
				}
				return out
			}

			const fetchTotals = async (): Promise<Partial<Record<MetricKey, number>>> => {
				const data = await runSql(
					`SELECT ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')}`
				)
				const row = data.results[0]
				return row ? readRow(row, 0) : {}
			}

			if (q.granularity === 'day' && !breakdownDim) {
				// HogQL buckets in the timezone argument when given; without it PostHog falls back
				// to the project's own timezone, so the resolved reporting timezone (UTC included)
				// is always passed to keep day buckets deterministic across projects. The window
				// literals stay UTC instants (already aligned to the reporting-timezone day
				// boundary by the caller).
				const dayExpr = `toStartOfDay(timestamp, ${sqlString(q.timezone ?? 'UTC')})`
				const seriesSql = `SELECT ${dayExpr} AS day, ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')} GROUP BY day ORDER BY day`
				const [seriesData, totals] = await Promise.all([runSql(seriesSql), fetchTotals()])
				const rows: AnalyticsRow[] = []
				for (const row of seriesData.results) {
					const ts = dayIso(String(row[0] ?? ''))
					if (ts) {
						rows.push({ timestamp: ts, metrics: readRow(row, 1) })
					}
				}
				return { rows, totals, meta: { provider: 'posthog', fetchedAt } }
			}

			if (q.granularity === 'hour' && !breakdownDim) {
				// Same timezone-bucketing rationale as the day branch above, at hour resolution.
				const hourExpr = `toStartOfHour(timestamp, ${sqlString(q.timezone ?? 'UTC')})`
				const seriesSql = `SELECT ${hourExpr} AS hour, ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')} GROUP BY hour ORDER BY hour`
				const [seriesData, totals] = await Promise.all([runSql(seriesSql), fetchTotals()])
				const rows: AnalyticsRow[] = []
				for (const row of seriesData.results) {
					const ts = hourIso(String(row[0] ?? ''))
					if (ts) {
						rows.push({ timestamp: ts, metrics: readRow(row, 1) })
					}
				}
				return { rows, totals, meta: { provider: 'posthog', fetchedAt } }
			}

			if (breakdownDim) {
				const dimSql = DIMENSION_SQL[breakdownDim] as string
				const sql = `SELECT ${dimSql} AS dim, ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')} GROUP BY dim ORDER BY m0 DESC LIMIT ${q.limit ?? 100}`
				const data = await runSql(sql)
				const rows: AnalyticsRow[] = data.results.map((row) => ({
					dimensions: { [breakdownDim]: String(row[0] ?? '') },
					metrics: readRow(row, 1),
				}))
				return { rows, totals: undefined, meta: { provider: 'posthog', fetchedAt } }
			}

			const totals = await fetchTotals()
			return { rows: [{ metrics: totals }], totals, meta: { provider: 'posthog', fetchedAt } }
		},
	}
}
