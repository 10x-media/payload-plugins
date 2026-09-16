import type { CaptureSupport } from '../../core/capture'
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
import { goalHint, goalsUnresolvedResult } from '../goalRead'
import { fetchJson } from '../http/fetchJson'
import { dayIso, hourIso } from '../series'

export interface PosthogConfig {
	/** PostHog project id (numeric). */
	projectId: string
	/** Personal API key with the "Query Read" scope (phx_...). Never exposed to the browser. */
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
	/** Cloud region for the proxied capture routes. Derived from `host` when omitted. */
	region?: 'us' | 'eu'
	/**
	 * The public browser key (phc_...) sent to `posthog.init`. Distinct from `apiKey`, the
	 * private Query API key, which must never reach the client. The adapter declares
	 * `capture` only when this is set: without it the install reads dashboards and captures
	 * nothing, so it gets no public proxy and no snippet.
	 */
	projectToken?: string
}

const US_CLOUD = 'https://us.posthog.com'

const resolveRegion = (config: PosthogConfig): 'us' | 'eu' => {
	if (config.region) {
		return config.region
	}
	return config.host?.includes('eu.posthog.com') ? 'eu' : 'us'
}

/**
 * PostHog's official install stub (https://posthog.com/docs/libraries/js), trimmed to the
 * methods this plugin and a host are likely to call before the SDK lands. It has to be one
 * self-sequencing script: `init` is what injects `array.js`, deriving the URL from
 * `api_host` (the `.i.posthog.com` rewrite is a no-op on a first-party proxy path, so it
 * resolves to `<path>/static/array.js`, exactly the route the proxy declares). Every call
 * made before the SDK arrives is queued on the stub and replayed by it.
 *
 * One addition to the official code: the injected tag inherits the nonce of the inline that
 * injected it, or a nonce CSP without `strict-dynamic` would pass the inline and block the
 * bundle. `document.currentScript` is the inline itself during its own synchronous run, on
 * the server-rendered path and the loader's path alike. The IDL property is read first
 * because browsers blank the content attribute once the document is parsed.
 */
const POSTHOG_STUB =
	'!function(t,e){var o,n,p,r,c;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(c=t.currentScript&&(t.currentScript.nonce||t.currentScript.getAttribute("nonce")))&&(p.nonce=c,p.setAttribute("nonce",c)),(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],o="init capture register register_once identify group alias reset setPersonProperties captureException opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing getFeatureFlag isFeatureEnabled reloadFeatureFlags onFeatureFlags on debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);'

function buildCapture(config: PosthogConfig, token: string): CaptureSupport {
	const region = resolveRegion(config)
	return {
		proxy: {
			trailingSlashes: true,
			routes: [
				{
					source: '/static/:p*',
					upstream: `https://${region}-assets.i.posthog.com/static/:p*`,
				},
				{
					source: '/array/:p*',
					upstream: `https://${region}-assets.i.posthog.com/array/:p*`,
				},
				{ source: '/:p*', upstream: `https://${region}.i.posthog.com/:p*` },
			],
		},
		snippet: ({ path }) => ({
			scripts: [
				{
					inline: `${POSTHOG_STUB}posthog.init(${JSON.stringify(token)},{api_host:${JSON.stringify(path)},ui_host:${JSON.stringify(`https://${region}.posthog.com`)}})`,
				},
			],
		}),
		client: { kind: 'posthog', token },
	}
}

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
// Events definition), `conversions`, or an `event`/`goal` breakdown is requested. The WHERE
// is not filtered to `$pageview`, so the pageview-family metrics scope themselves with
// conditional aggregates.
const METRIC_SQL_ALL: Partial<Record<MetricKey, string>> = {
	pageviews: "countIf(event = '$pageview')",
	visitors: "count(DISTINCT if(event = '$pageview', person_id, NULL))",
	visits: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	sessions: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	events: 'count()',
}

// A goal breakdown restricts the scan to the goal events themselves, so every metric counts
// the rows it already has. The conditional aggregates above would answer 0 for each one, and
// a conversion rate against a zeroed visitors count is 0% for every goal.
const METRIC_SQL_GOAL: Partial<Record<MetricKey, string>> = {
	pageviews: 'count()',
	visitors: 'count(DISTINCT person_id)',
	visits: 'count(DISTINCT properties.$session_id)',
	sessions: 'count(DISTINCT properties.$session_id)',
	events: 'count()',
}

/** A goal is an event name here, so a plugin goal's slug must equal the captured event's name. */
const DIMENSION_SQL: Partial<Record<DimensionKey, string>> = {
	page: 'properties.$pathname',
	event: 'event',
	goal: 'event',
}

// conversions has no fixed expression: it counts the read's own goal slugs, so the adapter
// builds its conditional aggregate per query.
const posthogMetrics: ReadonlySet<MetricKey> = new Set([
	...(Object.keys(METRIC_SQL_ALL) as MetricKey[]),
	'conversions',
])
const posthogDimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_SQL) as DimensionKey[]
)
// `goal` is a breakdown, not a filter: the read's own goal slugs own the event clause.
const posthogFilters: ReadonlySet<DimensionKey> = new Set(
	[...posthogDimensions].filter((dimension) => dimension !== 'goal')
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
		minGranularity: 'hour',
		maxLookbackDays,
		metrics: posthogMetrics,
		dimensions: posthogDimensions,
		filters: posthogFilters,
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
		...(config.projectToken ? { capture: buildCapture(config, config.projectToken) } : {}),
		isConfigured: () => Boolean(config.projectId && config.apiKey),
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const breakdownDim = (q.dimensions ?? []).find((d) => DIMENSION_SQL[d])
			const hint = goalHint(q)
			if (breakdownDim === 'goal' && !hint) {
				return goalsUnresolvedResult('posthog', q)
			}
			// A total-events metric, a goal or event-name breakdown, a conversions count, or a
			// filter on the event dimension must scan every event, not just pageviews (a
			// `$pageview` WHERE clause combined with an `event = 'x'` filter would be
			// self-contradictory and zero every metric); those reads switch to conditional
			// aggregation.
			const scanAllEvents =
				q.metrics.includes('events') ||
				q.metrics.includes('conversions') ||
				breakdownDim === 'event' ||
				breakdownDim === 'goal' ||
				(q.filters ?? []).some((f) => f.dimension === 'event' && DIMENSION_SQL[f.dimension])
			const eventInHint = hint ? `event IN (${hint.map(sqlString).join(', ')})` : undefined
			// Counting the goals conditionally, rather than restricting the WHERE, keeps the
			// site metrics of a read that asks for both site-wide.
			const metricSql: Partial<Record<MetricKey, string>> = {
				...(breakdownDim === 'goal'
					? METRIC_SQL_GOAL
					: scanAllEvents
						? METRIC_SQL_ALL
						: METRIC_SQL_PAGEVIEW),
				...(eventInHint ? { conversions: `countIf(${eventInHint})` } : {}),
			}
			const unresolved = q.metrics.includes('conversions') && !hint
			const wanted = q.metrics.filter((m) => metricSql[m])
			const exprs = [...new Set(wanted.map((m) => metricSql[m] as string))]
			const meta: AnalyticsResult['meta'] = {
				provider: 'posthog',
				fetchedAt,
				...(unresolved ? { goalsUnresolved: true as const } : {}),
			}

			const where = [
				`timestamp >= toDateTime(${sqlDateTimeLiteral(q.dateRange.start)})`,
				`timestamp <= toDateTime(${sqlDateTimeLiteral(q.dateRange.end)})`,
			]
			if (!scanAllEvents) {
				where.unshift("event = '$pageview'")
			}
			// Only the goal breakdown narrows the scan itself: its rows are the goals and
			// nothing else.
			if (breakdownDim === 'goal' && eventInHint) {
				where.push(eventInHint)
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
				const expr = posthogFilters.has(filter.dimension)
					? DIMENSION_SQL[filter.dimension]
					: undefined
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
				return { rows, totals, meta }
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
				return { rows, totals, meta }
			}

			if (breakdownDim) {
				const dimSql = DIMENSION_SQL[breakdownDim] as string
				const sql = `SELECT ${dimSql} AS dim, ${selectMetrics.join(', ')} FROM events WHERE ${where.join(' AND ')} GROUP BY dim ORDER BY m0 DESC LIMIT ${q.limit ?? 100}`
				const data = await runSql(sql)
				const rows: AnalyticsRow[] = data.results.map((row) => ({
					dimensions: { [breakdownDim]: String(row[0] ?? '') },
					metrics: readRow(row, 1),
				}))
				return { rows, totals: undefined, meta }
			}

			const totals = await fetchTotals()
			return { rows: [{ metrics: totals }], totals, meta }
		},
	}
}
