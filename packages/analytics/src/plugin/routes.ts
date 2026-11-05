/**
 * Every mount the plugin registers under `routes.api`, all off one base. Free of server code, so
 * client components and the browser tracker import it.
 */

import { isRecord } from '../core/values'

/** A path under `routes.api`, with its leading slash and without a trailing one. */
export type RouteBase = `/${string}`

/** Short, and no word an ad blocker's filter list would match. */
export const DEFAULT_ROUTE_BASE: RouteBase = '/_x'

/**
 * The plugin's key in `config.custom`, which holds its server-only runtime factory, and in
 * `config.admin.custom`, which reaches the client config and carries the resolved base.
 */
export const ANALYTICS_CONFIG_KEY = '@10x-media/analytics'

export interface RoutePaths {
	base: RouteBase
	/** Authenticated read over the surfacing engine. */
	query: string
	/** Authenticated read behind a document's analytics panel. */
	document: string
	/** Authenticated list of the sources a request may read. */
	sources: string
	/** Authenticated goal list for the admin goal picker. */
	goals: string
	/** Authenticated POST retiring a scope's cached reads. */
	refresh: string
	/** Authenticated realtime read the live counters poll. */
	live: string
	/** Authenticated exclusion link for the selected scope; mounted while `capture.exclusion` is on. */
	exclusion: string
	/** Public native ingest, and the default `native({ ingestPath })`. */
	ingest: string
	/** Public tracker config. */
	config: string
	/** Mount of the public capture proxy; a slot answers under `${proxy}/<slot>`. */
	proxy: string
	/** The capture proxy's registered pattern. */
	proxyPattern: string
	/** Mount of the public flag route; one flag answers under `${flags}/<code>.svg`. */
	flags: string
	/** The flag route's registered pattern. */
	flagsPattern: string
}

export const routePaths = (base: RouteBase): RoutePaths => ({
	base,
	query: `${base}/query`,
	document: `${base}/document`,
	sources: `${base}/sources`,
	goals: `${base}/goals`,
	refresh: `${base}/refresh`,
	live: `${base}/live`,
	exclusion: `${base}/exclusion`,
	ingest: `${base}/e`,
	config: `${base}/config`,
	proxy: `${base}/p`,
	proxyPattern: `${base}/p/:slot/:path*`,
	flags: `${base}/flags`,
	flagsPattern: `${base}/flags/:code`,
})

/** Plain segments of URL-safe characters, none starting with a dot. */
const BASE_PATTERN = /^(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/

/**
 * Payload strips a leading `/globals` from every API path before it routes, so a base starting
 * with it would be read as a global's route instead.
 */
const GLOBALS_PREFIX = '/globals'

/**
 * Payload looks a request's first segment up on `payload.collections`, a plain object, so one of
 * `Object.prototype`'s keys finds something there and every request fails before any endpoint runs.
 */
const INHERITED_KEYS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype))

const firstSegment = (path: string): string => path.split('/')[1] ?? ''

export const isRouteBase = (value: unknown): value is RouteBase =>
	typeof value === 'string' &&
	BASE_PATTERN.test(value) &&
	!value.startsWith(GLOBALS_PREFIX) &&
	!INHERITED_KEYS.has(firstSegment(value))

/** A `routes.base` option checked for a path Payload can route, or the default when unset. */
export const resolveRouteBase = (value: unknown): RouteBase => {
	if (value === undefined) {
		return DEFAULT_ROUTE_BASE
	}
	if (typeof value === 'string' && value.startsWith(GLOBALS_PREFIX)) {
		throw new Error(
			`analytics: routes.base "${value}" starts with "${GLOBALS_PREFIX}", which Payload routes to its globals; choose another first segment`
		)
	}
	if (typeof value === 'string' && INHERITED_KEYS.has(firstSegment(value))) {
		throw new Error(
			`analytics: routes.base "${value}" starts with "${firstSegment(value)}", a name every JavaScript object carries, which Payload would take for a collection; choose another first segment`
		)
	}
	if (!isRouteBase(value)) {
		throw new Error(
			`analytics: routes.base must be a path of plain segments such as "${DEFAULT_ROUTE_BASE}" (letters, digits, "-", "_", "." and "~", no trailing slash), got ${typeof value === 'string' ? `"${value}"` : typeof value}`
		)
	}
	return value
}

/** The base's first segment, which Payload compares against every collection slug. */
export const routeBaseSegment = (base: RouteBase): string => firstSegment(base)

/**
 * The collection that would take every request under the base: Payload hands `<api>/<segment>/...`
 * to the collection slugged `<segment>` before it tries a root endpoint.
 */
export const shadowingCollection = (
	base: RouteBase,
	slugs: Iterable<string>
): string | undefined => {
	const segment = routeBaseSegment(base)
	for (const slug of slugs) {
		if (slug === segment) {
			return slug
		}
	}
	return undefined
}

/** Refuses a base some collection would shadow, naming that collection and the option to change. */
export const assertRouteBaseUnshadowed = (base: RouteBase, slugs: Iterable<string>): void => {
	const slug = shadowingCollection(base, slugs)
	if (slug !== undefined) {
		throw new Error(
			`analytics: the "${slug}" collection's slug is the first segment of routes.base "${base}", so Payload would hand every analytics request to that collection. Set routes.base to a path whose first segment is no collection's slug.`
		)
	}
}

/** What the plugin leaves under its key in `config.admin.custom`. */
export interface AnalyticsAdminCustom {
	routes: { base: RouteBase }
}

/** The slice of a root endpoint the route checks read. */
export interface RootEndpointShape {
	method: string
	path: string
	custom?: Record<string, unknown> | undefined
}

/**
 * The endpoint with the plugin's mark in its `custom`, which is how the route checks tell the
 * plugin's own root endpoints from those registered before it.
 */
export const pluginEndpoint = <T extends RootEndpointShape>(endpoint: T): T => ({
	...endpoint,
	custom: { ...endpoint.custom, [ANALYTICS_CONFIG_KEY]: true },
})

export const isPluginEndpoint = (endpoint: RootEndpointShape): boolean =>
	endpoint.custom?.[ANALYTICS_CONFIG_KEY] === true

/** The slice of a Payload config, server or client, the base is read from. */
export interface RoutesConfigSource {
	admin?: { custom?: Record<string, unknown> } | undefined
}

/**
 * The mounts one Payload config resolved, read from `config.admin.custom` by server and client
 * code alike. A config the plugin never touched answers the default base.
 */
export const analyticsRoutes = (config: RoutesConfigSource | null | undefined): RoutePaths => {
	const entry = config?.admin?.custom?.[ANALYTICS_CONFIG_KEY]
	const routes = isRecord(entry) ? entry.routes : undefined
	const base = isRecord(routes) ? routes.base : undefined
	return routePaths(isRouteBase(base) ? base : DEFAULT_ROUTE_BASE)
}
