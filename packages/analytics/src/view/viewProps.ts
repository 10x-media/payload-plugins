import type { PayloadRequest } from 'payload'
import { readGate } from '../access/readGate'
import { type MetricKey, PLATFORM_SCOPE } from '../core/contract'
import { DEFAULT_VIEW, type ResolvedOptions } from '../core/options'
import { type RequestedScope, resolveRequestedScope } from '../core/scopedRead'
import type { SourcesResponse } from '../fields/config/fetchSources'
import { apiPath } from '../plugin/apiPath'
import { resolveSourcesForRequest } from '../plugin/readContextForRequest'
import { analyticsRoutes } from '../plugin/routes'
import {
	type AnalyticsRuntime,
	getRuntime,
	goalNamesFor,
	resolveCurrencyFor,
	resolveScopeFor,
	resolveTimezoneFor,
	type ScopeGates,
	scopeGates,
} from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { intlLocale } from '../translations/intl'
import type { CountryFlags } from './CountryFlag'
import { aggregateFrom, isAggregateToken } from './state'

/**
 * A goal as the view lists it: the picker needs no match or value details.
 *
 * @beta
 */
export interface ViewGoal {
	slug: string
	name: string
}

/**
 * Which scope the view reads; scoped installs only. The host owns the scope and the view only
 * toggles aggregation, so `own` sits beside `current` for the Site select to switch back to.
 *
 * @beta
 */
export interface ViewScopes {
	/** The scope the reads carry: `'*'` for every scope at once, `''` for none. */
	current: string
	/** The scope this request resolves to on its own, whatever the URL asked for. */
	own: string
	/** What `scope.label` calls `own`, when it names it. */
	ownLabel?: string
	/** `access.crossScope.aggregate` for this request; gates the Site select. */
	canAggregate: boolean
}

/**
 * The endpoints the view reads through, each under the app's `routes.api` and the plugin's base.
 *
 * @beta
 */
export interface ViewEndpoints {
	query: string
	refresh: string
	live: string
}

/**
 * Everything the client shell needs to render without a second round trip. Serializable
 * by construction: the RSC boundary drops functions, so only wire shapes appear here.
 *
 * @beta
 */
export interface AnalyticsViewClientProps {
	/** Same payload the sources endpoint answers, resolved for this request's scope. */
	sources: SourcesResponse
	goals: ViewGoal[]
	defaults: { range: TimeframePreset; metric: MetricKey }
	endpoints: ViewEndpoints
	adminRoute: string
	/** IANA reporting timezone the day boundaries align to. */
	timezone: string
	/** ISO 4217 code revenue is formatted in, from `revenue.currency`; absent, a plain number. */
	currency?: string
	/** Admin UI language (`req.i18n.language`), for number and date formatting. */
	locale: string
	/**
	 * The flag beside a country name: `true` the plugin's own, or the host's `countryFlags.Component`
	 * as the server shell looked it up, which every row renders with its `code`.
	 */
	countryFlags: CountryFlags
	/**
	 * Scope this render resolved to, `''` for none. Keys the client body: a host tenant switch's
	 * `router.refresh()` keeps client state, and two tenants' reads can be identical strings.
	 */
	scopeKey: string
	/** Scope caption and Site select; absent on an unscoped install. */
	scopes?: ViewScopes
	/**
	 * The `scope` the URL may keep: the aggregate token this request honoured, else absent. The
	 * client rewrites the address to match what was read.
	 */
	scopeParam?: string
	/**
	 * Where the view asks for the exclusion link of the reader's own scope, while
	 * `capture.exclusion` is on; absent, the view offers no exclusion at all.
	 */
	exclusion?: { endpoint: string }
	/**
	 * The reader works per site and has none selected (a scoped install that resolved no scope
	 * for them), so the view asks for one instead of reporting that no source is connected.
	 */
	needsScope?: boolean
}

/**
 * `denied` is a value, not a thrown error, so the view renders its no-access message inside the
 * admin template instead of redirecting a signed-in reader.
 */
export type ViewPropsResult = { denied: true } | { denied: false; props: AnalyticsViewClientProps }

/**
 * Goals the request's scope may see, mirroring the goals endpoint; a failed resolution falls back
 * to config goals only when unscoped.
 */
const resolveGoalsList = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<ViewGoal[]> => {
	try {
		return await goalNamesFor({ runtime, req, scope })
	} catch (err) {
		req.payload.logger?.warn(`analytics: view goals listing failed: ${String(err)}`)
		return runtime.scoped
			? []
			: (runtime.goals ?? []).map((goal) => ({ slug: goal.slug, name: goal.name }))
	}
}

const emptySources = (): SourcesResponse => ({ defaultId: null, sources: [] })

/**
 * Caption scope and Site select state. `own` resolves apart from `current` so the select keeps
 * naming the reader's own tenant while reads aggregate.
 */
const resolveScopes = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	gates: ScopeGates
	current: string
	own: string
}): Promise<ViewScopes> => {
	const { runtime, req, gates, current, own } = args
	const ownLabel = await resolveOwnLabel(runtime, req, own)
	return {
		current,
		own,
		canAggregate: await gates.aggregate(),
		...(ownLabel === undefined ? {} : { ownLabel }),
	}
}

/** What to call the request's own scope; the id stands wherever the host names nothing. */
const resolveOwnLabel = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string
): Promise<string | undefined> => {
	if (!runtime.scopeLabel || scope === '' || scope === PLATFORM_SCOPE) {
		return undefined
	}
	try {
		return (await runtime.scopeLabel({ req, scope })) ?? undefined
	} catch (err) {
		req.payload.logger?.warn(`analytics: scope.label failed: ${String(err)}`)
		return undefined
	}
}

/** The `scope` a URL is allowed to carry into the view: an aggregate token, and nothing else. */
const requestedAggregate = (searchParams: ViewSearchParams | undefined): string | undefined => {
	const raw = searchParams?.scope
	const value = Array.isArray(raw) ? raw[0] : raw
	return typeof value === 'string' && isAggregateToken(value) ? value : undefined
}

/**
 * The scope this request resolves to on its own; `''` for none, for a resolver that threw, and
 * for a tenant the user selected without belonging to it, whose name the view never shows.
 */
const ownScopeFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	own: RequestedScope
): Promise<string> => {
	if (own.ok) {
		return own.scope ?? ''
	}
	if (own.reason !== 'unresolved') {
		return ''
	}
	try {
		return (await resolveScopeFor(runtime, req)) ?? ''
	} catch {
		return ''
	}
}

/** The admin view's `searchParams`, as Payload hands them to a server component. */
export type ViewSearchParams = { [key: string]: string | string[] | undefined }

/**
 * Client shell props for one request. Host's `scope.resolve` is the one scope authority: the URL
 * may only ask to aggregate (granted by `access.crossScope.aggregate`); other `scope` values drop.
 */
export const resolveViewProps = async (
	req: PayloadRequest,
	resolved: ResolvedOptions,
	searchParams?: ViewSearchParams
): Promise<ViewPropsResult> => {
	if (!(await resolved.access.view({ req }))) {
		return { denied: true }
	}
	// `false` cannot reach a render (the view is then never registered); it defaults anyway.
	const view = resolved.view === false ? DEFAULT_VIEW : resolved.view
	const runtime = getRuntime(req.payload)
	const config = req.payload.config
	const routes = analyticsRoutes(config)
	const base = {
		defaults: { range: view.defaultRange, metric: view.defaultMetric },
		endpoints: {
			query: apiPath(config, routes.query),
			refresh: apiPath(config, routes.refresh),
			live: apiPath(config, routes.live),
		},
		adminRoute: config.routes?.admin ?? '/admin',
		locale: intlLocale(req.i18n.language),
		// The host's component is looked up by the view's body (`renderViewBody`), which hands it on.
		countryFlags: resolved.countryFlags === true,
		...(resolved.capture.exclusion
			? { exclusion: { endpoint: apiPath(config, routes.exclusion) } }
			: {}),
	}
	// No runtime means the plugin is not installed on this instance: nothing is readable.
	if (!runtime) {
		return {
			denied: false,
			props: {
				...base,
				sources: emptySources(),
				goals: [],
				timezone: DEFAULT_TIMEZONE,
				scopeKey: '',
			},
		}
	}
	const gates = scopeGates(runtime, req)
	const token = requestedAggregate(searchParams)
	const ownRequested = await resolveRequestedScope({ runtime, req, gates })
	const own = await ownScopeFor(runtime, req, ownRequested)
	// The aggregate belongs to the tenant it was chosen from; the host's selector can move while
	// the address stays open, so a token tagged with another falls back to the request's scope.
	const aggregate = token !== undefined && aggregateFrom(token) === own
	// A wildcard this reader may not have degrades to their own scope rather than to nothing:
	// they are entitled to that read, and the client rewrites the address to match.
	let requested = ownRequested
	if (aggregate) {
		const all = await resolveRequestedScope({ runtime, req, gates, raw: PLATFORM_SCOPE })
		if (all.ok) {
			requested = all
		}
	}
	const scope = requested.ok ? requested.scope : null
	const scopeKey = scope ?? ''
	const registryScope = scope === PLATFORM_SCOPE ? null : scope
	// `access.view` may be wider than `access.read`: goal names and scope names are read data too.
	const readable = await readGate(runtime, req).catch(() => false)
	const [sources, goals, timezone, currency, scopes] = await Promise.all([
		requested.ok
			? resolveSourcesForRequest(req, { gates, scope: requested.gated })
			: emptySources(),
		requested.ok && readable ? resolveGoalsList(runtime, req, scope) : [],
		resolveTimezoneFor(runtime, req, registryScope).catch(() => DEFAULT_TIMEZONE),
		resolveCurrencyFor(runtime, req, registryScope),
		runtime.scoped === true && readable
			? resolveScopes({ runtime, req, gates, current: scopeKey, own })
			: undefined,
	])
	return {
		denied: false,
		props: {
			...base,
			sources: { defaultId: sources.defaultId, sources: sources.sources },
			goals,
			timezone,
			scopeKey,
			...(scope === PLATFORM_SCOPE && token !== undefined ? { scopeParam: token } : {}),
			...(!requested.ok && requested.reason === 'unresolved' ? { needsScope: true } : {}),
			...(currency ? { currency } : {}),
			...(scopes ? { scopes } : {}),
		},
	}
}
