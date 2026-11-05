import { jsLiteral } from '../../capture/jsLiteral'
import {
	adapterWithoutConsent,
	cookielessCapture,
	WITHOUT_CONSENT_LEVELS,
} from '../../capture/withoutConsent'
import type { CaptureSupport, ProxyRoute, SnippetMode } from '../../core/capture'
import { currentTime } from '../../core/clock'
import {
	type AdapterContext,
	type AnalyticsAdapter,
	type AnalyticsCapabilities,
	type AnalyticsQuery,
	type AnalyticsResult,
	type AnalyticsRow,
	DIMENSION_KEYS,
	type DimensionKey,
	type FilterOperator,
	type MetricKey,
	type MetricValues,
} from '../../core/contract'
import type { FetchLike } from '../../core/fetch'
import { vendorReading } from '../../core/metricValues'
import { type AdapterLabelOption, adapterLabel } from '../../core/sourceLabel'
import { DEFAULT_TIMEZONE } from '../../timeframe/tz'
import type { WithoutConsentLevel } from '../../tracker/config'
import { emptyGoalBreakdown, goalHint, hintFailed, hintSlugs } from '../goalRead'
import { hostnameOf, withoutTrailingSlash } from '../http/baseUrl'
import {
	declaredFilters,
	everyOperatorOn,
	firstMapped,
	mappedKeys,
	providerMetricKeys,
} from '../mapping'
import { readTime } from '../readTime'
import { dayIso, hourIso } from '../series'
import { upstreamJson } from '../upstream'
import { createProjectCheck } from './projectCheck'

export interface PosthogConfig {
	/**
	 * The source's name in pickers and listings: a string, a map by admin language (read like
	 * `view.navLabel`), or a function naming it per reader and scope. Default `'PostHog'`.
	 */
	label?: AdapterLabelOption
	/** PostHog project id (numeric). */
	projectId: string
	/** Personal API key with the "Query Read" scope (phx_...). Never exposed to the browser. */
	apiKey: string
	/**
	 * API address. Defaults to US Cloud; EU is https://eu.posthog.com, self-host is your instance's
	 * address, with the base path when a reverse proxy serves it under one.
	 */
	host?: string
	/** Maximum days of historical data. Defaults to 730. Pass null to disable clamping. */
	maxLookbackDays?: number | null
	/**
	 * Event property holding a read's scope (e.g. 'tenant'): one project captures every scope with it
	 * set, and a scoped read filters on it as an escaped literal.
	 */
	scopeProperty?: string
	/**
	 * PostHog Cloud region for the proxied capture routes. Derived from `host` when omitted. A
	 * self-hosted `host` takes capture itself and ignores this.
	 */
	region?: 'us' | 'eu'
	/**
	 * The PostHog app's address, passed as `ui_host` so toolbar links open the app, not the proxy. A
	 * self-hosted instance gets none unless this names it, so no page publishes its address on its own.
	 */
	uiHost?: string
	/**
	 * The public browser key (phc_...) for `posthog.init`, never the private `apiKey`. Capture is
	 * declared only when this is set: without it the install reads dashboards and captures nothing.
	 */
	projectToken?: string
	/** The fetch reads and the capture proxy reach PostHog with. Unset, the global fetch. */
	fetch?: FetchLike
	/**
	 * What this source's held slot does without consent, over `capture.withoutConsent`.
	 * `'cookieless'` counts with PostHog's cookieless mode until consent, which needs the project's
	 * "Cookieless tracking" (Web analytics settings); `'off'` keeps PostHog opted out until then.
	 */
	withoutConsent?: WithoutConsentLevel
}

const US_CLOUD = 'https://us.posthog.com'

const resolveRegion = (config: PosthogConfig): 'us' | 'eu' => {
	if (config.region) {
		return config.region
	}
	return config.host?.includes('eu.posthog.com') ? 'eu' : 'us'
}

/**
 * PostHog's official stub, trimmed: one self-sequencing script whose `init` injects `array.js` from
 * the proxy. Added: the injected tag inherits the inline's nonce, or a nonce CSP blocks the bundle.
 * Changed for a second slot's named client: `init` stays the stub's own rather than a queued call, so
 * that client gets its own queue at once; only the first `init` injects `array.js`; and a loaded
 * posthog-js (no longer an array) is never replaced, so the client is initialised on it.
 */
const POSTHOG_STUB =
	'!function(t,e){var o,n,p,r,c;e.__SV||!Array.isArray(e)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}e.__L||(e.__L=1,(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(c=t.currentScript&&(t.currentScript.nonce||t.currentScript.getAttribute("nonce")))&&(p.nonce=c,p.setAttribute("nonce",c)),(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],o="capture register register_once identify group alias reset setPersonProperties captureException opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing getFeatureFlag isFeatureEnabled reloadFeatureFlags onFeatureFlags on debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);'

/** Whether an address is PostHog Cloud's, which serves capture from per-region hosts of its own. */
const isCloudHost = (address: string): boolean => {
	const hostname = hostnameOf(address)
	return hostname === 'posthog.com' || hostname.endsWith('.posthog.com')
}

interface CaptureHosts {
	assets: string
	ingest: string
	cloud: boolean
	ui?: string
}

/**
 * Where capture goes and app links point. PostHog Cloud splits assets and ingest hosts; a self-hosted
 * instance serves both at the read address, as posthog-js assumes for any non-Cloud `api_host`.
 */
const captureHosts = (config: PosthogConfig): CaptureHosts => {
	const host = config.host === undefined ? undefined : withoutTrailingSlash(config.host)
	const ui = config.uiHost === undefined ? undefined : withoutTrailingSlash(config.uiHost)
	if (host !== undefined && !isCloudHost(host)) {
		return { assets: host, ingest: host, cloud: false, ...(ui === undefined ? {} : { ui }) }
	}
	const region = resolveRegion(config)
	return {
		assets: `https://${region}-assets.i.posthog.com`,
		ingest: `https://${region}.i.posthog.com`,
		cloud: true,
		ui: ui ?? `https://${region}.posthog.com`,
	}
}

/**
 * The paths posthog-js sends to on a self-hosted instance, which is also the whole app with its
 * login and admin: its proxy declares these alone, and Cloud's capture-only hosts keep the catch-all.
 */
export const POSTHOG_SELF_HOSTED_CAPTURE_PATHS: readonly string[] = [
	'/e',
	'/i/v0/e',
	'/batch',
	'/capture',
	'/track',
	'/engage',
	'/decide',
	'/flags',
	'/s',
]

const dataRoutes = (hosts: CaptureHosts): ProxyRoute[] =>
	hosts.cloud
		? [{ source: '/:p*', upstream: `${hosts.ingest}/:p*`, kind: 'data' }]
		: POSTHOG_SELF_HOSTED_CAPTURE_PATHS.map((path) => ({
				source: path,
				upstream: `${hosts.ingest}${path}`,
				kind: 'data',
			}))

/**
 * posthog-js's single-page-app mode: without it every navigation after the first page is lost, since
 * the vendor sink forwards no pageview to the primary client.
 */
const CAPTURE_PAGEVIEW = 'history_change'

/**
 * A named client counts no pageview itself: posthog-js wraps `history.pushState` for the first
 * client alone, so the sink hands it the tracker's pageviews. Its pageleave, which PostHog ties to
 * its own pageviews, is asked for outright.
 */
const NAMED_CLIENT_PAGEVIEWS = ['capture_pageview:false', 'capture_pageleave:true']

/**
 * A slot counting without consent boots in PostHog's cookieless mode, which an opt-out returns to
 * rather than stopping. Started cookieless, it counts from the first pageview while opted out by
 * default, storing nothing, until the sink opts it in.
 */
const cookielessOptions = (mode: SnippetMode): string[] => [
	`cookieless_mode:${jsLiteral('on_reject')}`,
	...(mode === 'cookieless' ? ['opt_out_capturing_by_default:true'] : []),
]

/**
 * The scope stamped on each event as it is sent: switching between cookieless and full resets
 * PostHog's identity and every super-property `register` set with it.
 */
const scopeHook = (property: string, scope: string): string =>
	`before_send:function(e){e&&e.properties&&(e.properties[${jsLiteral(property)}]=${jsLiteral(scope)});return e}`

/**
 * `opt_out_persistence_by_default` makes an opt-out (closed gate, excluded browser) delete PostHog's
 * `ph_<token>_posthog` storage, distinct id included, and keep none while it holds.
 */
const initOptions = (path: string, ui: string | undefined, named: boolean): string[] => [
	`api_host:${jsLiteral(path)}`,
	...(ui === undefined ? [] : [`ui_host:${jsLiteral(ui)}`]),
	...(named ? NAMED_CLIENT_PAGEVIEWS : [`capture_pageview:${jsLiteral(CAPTURE_PAGEVIEW)}`]),
	'opt_out_persistence_by_default:true',
]

function buildCapture(config: PosthogConfig, token: string): CaptureSupport {
	const hosts = captureHosts(config)
	return {
		proxy: {
			trailingSlashes: true,
			routes: [
				{ source: '/static/:p*', upstream: `${hosts.assets}/static/:p*`, kind: 'script' },
				{ source: '/array/:p*', upstream: `${hosts.assets}/array/:p*`, kind: 'script' },
				...dataRoutes(hosts),
			],
			...(config.fetch ? { fetch: config.fetch } : {}),
		},
		snippet: ({ path, scope, instance, mode = 'full', withoutConsent = false }) => {
			const named = instance !== undefined
			const client = named ? `posthog[${jsLiteral(instance)}]` : 'posthog'
			const property = config.scopeProperty && scope ? config.scopeProperty : undefined
			// Stamped on every event rather than per call, so it rides the events a host captures itself,
			// which is what `scopeProperty` reads back on.
			const stamp =
				property && scope && !withoutConsent
					? `;${client}.register({[${jsLiteral(property)}]:${jsLiteral(scope)}})`
					: ''
			const options = [
				...initOptions(path, hosts.ui, named),
				...(withoutConsent ? cookielessOptions(mode) : []),
				...(withoutConsent && property && scope ? [scopeHook(property, scope)] : []),
			].join(',')
			const name = named ? `,${jsLiteral(instance)}` : ''
			return {
				scripts: [
					{
						inline: `${POSTHOG_STUB}posthog.init(${jsLiteral(token)},{${options}}${name})${stamp}`,
					},
				],
			}
		},
		client: { kind: 'posthog', token },
	}
}

// Pageview-scoped expressions, for a WHERE filtered to `$pageview`. visits and sessions
// share one expression, deduped before the SELECT and read back by position.
const METRIC_SQL_PAGEVIEW: Partial<Record<MetricKey, string>> = {
	pageviews: 'count()',
	visitors: 'count(DISTINCT person_id)',
	visits: 'count(DISTINCT properties.$session_id)',
	sessions: 'count(DISTINCT properties.$session_id)',
}

// All-event expressions, for `events`, `conversions` or an `event`/`goal` breakdown: the
// WHERE keeps every event, so pageview metrics scope themselves with conditional aggregates.
const METRIC_SQL_ALL: Partial<Record<MetricKey, string>> = {
	pageviews: "countIf(event = '$pageview')",
	visitors: "count(DISTINCT if(event = '$pageview', person_id, NULL))",
	visits: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	sessions: "count(DISTINCT if(event = '$pageview', properties.$session_id, NULL))",
	events: 'count()',
}

// A goal breakdown scans only the goal events, so every metric counts the rows it has: the
// conditional aggregates above would zero visitors, and every goal's conversion rate with it.
const METRIC_SQL_GOAL: Partial<Record<MetricKey, string>> = {
	pageviews: 'count()',
	visitors: 'count(DISTINCT person_id)',
	visits: 'count(DISTINCT properties.$session_id)',
	sessions: 'count(DISTINCT properties.$session_id)',
	events: 'count()',
}

/**
 * An event counted without consent. Ingestion keeps `$cookieless_mode` while it strips the address;
 * compared as text, it matches whether the project types the property as a boolean or not.
 */
const COOKIELESS_EVENT = "toString(properties.$cookieless_mode) = 'true'"

/**
 * A goal is an event name, so its slug must equal the captured event's. `channel` is PostHog's own
 * `$channel_type`, computed per session and honouring a project's custom channel rules.
 */
const DIMENSION_SQL: Partial<Record<DimensionKey, string>> = {
	page: 'properties.$pathname',
	channel: 'session.$channel_type',
	event: 'event',
	goal: 'event',
}

const posthogMetrics: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'events',
	// No fixed expression: it counts the read's own goal slugs, so each query builds its own.
	'conversions',
])
const posthogDimensions = mappedKeys(DIMENSION_KEYS, DIMENSION_SQL)
const posthogFilters = everyOperatorOn(posthogDimensions)

// The Query API has no parameter binding, so values are inlined as quoted literals.
// Escape backslashes first, then single quotes, so a crafted path cannot break out.
const sqlString = (value: string): string =>
	`'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// ILIKE reads % and _ as wildcards and \ as its escape, so \ is escaped first (a raw one
// would escape the next character), then % and _, before the value is wrapped in % ... %.
const escapeLikeValue = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Each filter operator as HogQL on a dimension's expression. */
const FILTER_SQL: Record<FilterOperator, (expr: string, value: string) => string> = {
	eq: (expr, value) => `${expr} = ${sqlString(value)}`,
	contains: (expr, value) => `${expr} ILIKE ${sqlString(`%${escapeLikeValue(value)}%`)}`,
	matches: (expr, value) => `match(${expr}, ${sqlString(value)})`,
}

interface SeriesBucket {
	/** The HogQL function that buckets a timestamp. */
	fn: string
	/** A bucket label read back as an ISO instant. */
	isoOf: (label: string) => string | null
}

const SERIES_BUCKETS: Record<'day' | 'hour', SeriesBucket> = {
	day: { fn: 'toStartOfDay', isoOf: dayIso },
	hour: { fn: 'toStartOfHour', isoOf: hourIso },
}

/**
 * A bare HogQL date literal parses in the project's timezone, so the zone is passed explicitly to
 * keep the bound an absolute instant.
 */
const utcDateTime = (d: Date): string =>
	`toDateTime(${sqlString(d.toISOString().slice(0, 19).replace('T', ' '))}, 'UTC')`

interface PosthogQueryResponse {
	columns: string[]
	types: string[]
	results: unknown[][]
}

export function posthog(config: PosthogConfig): AnalyticsAdapter {
	const host = withoutTrailingSlash(config.host ?? US_CLOUD)
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 730
	const withoutConsent = adapterWithoutConsent(
		config.withoutConsent,
		'posthog({ withoutConsent })',
		WITHOUT_CONSENT_LEVELS
	)

	const capabilities: AnalyticsCapabilities = {
		realtime: false,
		minGranularity: 'hour',
		maxLookbackDays,
		metrics: posthogMetrics,
		dimensions: posthogDimensions,
		filters: posthogFilters,
		semantics: { visitors: 'distinct', sessions: 'provider' },
		rateLimit: { requestsPerMinute: 240, requestsPerHour: 2400 },
		recommendedTtl: { realtime: 300, aggregate: 3600 },
		upstreamAware: true,
		...(config.scopeProperty ? { scopedQueries: true } : {}),
	}

	let fillsCountingSlot = true
	const projectDropsCookieless = createProjectCheck({
		host,
		projectId: config.projectId,
		apiKey: config.apiKey,
		...(config.fetch ? { fetch: config.fetch } : {}),
	})
	/**
	 * Whether a held slot this source fills may count cookielessly, which the project must accept:
	 * the boot's answer for a config source, the factory's `withoutConsent` for a document's.
	 */
	const countsCookieless = (): boolean =>
		Boolean(config.projectToken) && withoutConsent !== 'off' && fillsCountingSlot

	return {
		id: 'posthog',
		...adapterLabel(config.label, 'PostHog', 'posthog({ label })'),
		capabilities,
		...(config.projectToken
			? {
					capture: {
						...buildCapture(config, config.projectToken),
						...cookielessCapture({ kind: 'switched' }, withoutConsent),
					},
				}
			: {}),
		isConfigured: () => Boolean(config.projectId && config.apiKey),
		register(_config, context) {
			fillsCountingSlot = context?.adapterCountsWithoutConsent !== false
		},
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = readTime(ctx)
			const dropped = countsCookieless()
				? projectDropsCookieless(ctx.now?.().getTime() ?? currentTime())
				: Promise.resolve(undefined)
			const breakdown = firstMapped(q.dimensions, DIMENSION_SQL)
			const goalBreakdown = breakdown?.dimension === 'goal'
			const hint = goalHint(q)
			let cookieless = 0
			/** The result with what the read learnt about events counted without consent. */
			const withConsentMeta = async (result: AnalyticsResult): Promise<AnalyticsResult> => {
				const drops = await dropped
				const counted = cookieless > 0
				return {
					...result,
					meta: {
						...result.meta,
						...(counted && q.metrics.includes('visitors') ? { visitorsAre: 'sumOfDaily' } : {}),
						...(counted && !breakdown && q.metrics.includes('pageviews')
							? { withoutConsent: { pageviews: cookieless } }
							: {}),
						...(drops ? { withoutConsentDropped: true } : {}),
					},
				}
			}
			const empty = goalBreakdown
				? emptyGoalBreakdown({ provider: 'posthog', fetchedAt, hint })
				: null
			if (empty) {
				return withConsentMeta(empty)
			}
			// These reads scan every event: a `$pageview` WHERE beside an `event = 'x'` filter would
			// contradict itself and zero every metric, so they switch to conditional aggregation.
			const scanAllEvents =
				q.metrics.includes('events') ||
				q.metrics.includes('conversions') ||
				breakdown?.dimension === 'event' ||
				goalBreakdown ||
				(q.filters ?? []).some((f) => f.dimension === 'event')
			const slugs = hintSlugs(hint)
			const eventInHint = slugs ? `event IN (${slugs.map(sqlString).join(', ')})` : undefined
			// Counting the goals conditionally, rather than restricting the WHERE, keeps the
			// site metrics of a read that asks for both site-wide.
			const metricSql: Partial<Record<MetricKey, string>> = {
				...(goalBreakdown ? METRIC_SQL_GOAL : scanAllEvents ? METRIC_SQL_ALL : METRIC_SQL_PAGEVIEW),
				...(eventInHint ? { conversions: `countIf(${eventInHint})` } : {}),
			}
			const exprs = providerMetricKeys(q.metrics, metricSql)
			const unresolved = q.metrics.includes('conversions') && hintFailed(hint)
			const meta: AnalyticsResult['meta'] = {
				provider: 'posthog',
				fetchedAt,
				...(unresolved ? { goalsUnresolved: true as const } : {}),
			}

			const where = [
				...(scanAllEvents ? [] : ["event = '$pageview'"]),
				`timestamp >= ${utcDateTime(q.dateRange.start)}`,
				`timestamp <= ${utcDateTime(q.dateRange.end)}`,
			]
			// Only the goal breakdown narrows the scan itself: its rows are the goals and
			// nothing else.
			if (goalBreakdown && eventInHint) {
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
			for (const { filter, field } of declaredFilters(capabilities, q.filters, DIMENSION_SQL)) {
				where.push(FILTER_SQL[filter.operator](field, filter.value))
			}
			const columns = exprs.map((expr, i) => `${expr} AS m${i}`).join(', ')
			const from = `FROM events WHERE ${where.join(' AND ')}`
			// A column on the totals or breakdown query the read runs anyway, never a request of its
			// own. Visitors are counted on pageviews, except in a goal breakdown, which counts its rows.
			const cookielessRows =
				scanAllEvents && !goalBreakdown
					? `event = '$pageview' AND ${COOKIELESS_EVENT}`
					: COOKIELESS_EVENT
			const countsCookielessColumn =
				q.metrics.includes('visitors') || (!breakdown && q.metrics.includes('pageviews'))
			const cookielessColumn = countsCookielessColumn ? `, countIf(${cookielessRows}) AS c` : ''
			/** Adds a result row's count of events counted without consent, after its metric columns. */
			const tallyCookieless = (row: unknown[], offset: number): void => {
				if (countsCookielessColumn) {
					cookieless += vendorReading('pageviews', row[offset + exprs.length]) ?? 0
				}
			}

			const runSql = (sql: string): Promise<PosthogQueryResponse> =>
				upstreamJson<PosthogQueryResponse>(ctx, `${host}/api/projects/${config.projectId}/query/`, {
					method: 'POST',
					headers: { authorization: `Bearer ${config.apiKey}` },
					body: { query: { kind: 'HogQLQuery', query: sql } },
					provider: 'posthog',
					fetch: config.fetch,
				})

			/** A result row's metrics, its metric columns starting at `offset`. */
			const readRow = (row: unknown[], offset: number): MetricValues => {
				const out: MetricValues = {}
				for (const metric of q.metrics) {
					const expr = metricSql[metric]
					if (expr !== undefined) {
						out[metric] = vendorReading(metric, row[offset + exprs.indexOf(expr)])
					}
				}
				return out
			}

			const fetchTotals = async (): Promise<MetricValues> => {
				const data = await runSql(`SELECT ${columns}${cookielessColumn} ${from}`)
				const row = data.results[0]
				if (!row) {
					return {}
				}
				tallyCookieless(row, 0)
				return readRow(row, 0)
			}

			const unit =
				!breakdown && (q.granularity === 'day' || q.granularity === 'hour')
					? q.granularity
					: undefined
			if (unit) {
				const { fn, isoOf } = SERIES_BUCKETS[unit]
				// Without a timezone argument HogQL buckets in the project's zone, so the reporting zone
				// (UTC included) is always passed; the window literals stay UTC instants, already aligned.
				const bucket = `${fn}(timestamp, ${sqlString(q.timezone ?? DEFAULT_TIMEZONE)})`
				const [series, totals] = await Promise.all([
					runSql(
						`SELECT ${bucket} AS ${unit}, ${columns} ${from} GROUP BY ${unit} ORDER BY ${unit}`
					),
					fetchTotals(),
				])
				const rows: AnalyticsRow[] = []
				for (const row of series.results) {
					const timestamp = isoOf(String(row[0] ?? ''))
					if (timestamp) {
						rows.push({ timestamp, metrics: readRow(row, 1) })
					}
				}
				return withConsentMeta({ rows, totals, meta })
			}

			if (breakdown) {
				const data = await runSql(
					`SELECT ${breakdown.field} AS dim, ${columns}${cookielessColumn} ${from} GROUP BY dim ORDER BY m0 DESC LIMIT ${q.limit ?? 100}`
				)
				const rows: AnalyticsRow[] = data.results.map((row) => {
					tallyCookieless(row, 1)
					return {
						dimensions: { [breakdown.dimension]: String(row[0] ?? '') },
						metrics: readRow(row, 1),
					}
				})
				return withConsentMeta({ rows, totals: undefined, meta })
			}

			const totals = await fetchTotals()
			return withConsentMeta({ rows: [{ metrics: totals }], totals, meta })
		},
	}
}
