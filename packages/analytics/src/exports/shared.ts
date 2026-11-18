/**
 * Helpers with no server and no React dependency: the query contract's dimension and operator
 * lists, the route paths, the error codes and their readers, the timeframe presets and the
 * metric formatter. A host module that both server code and client components import reads them
 * from here; the root is the server plugin and `./client` is a client entry.
 */

export type { DateRange, SourceErrorKind, VisitorCounting } from '../core/contract'
export {
	type AnalyticsFilter,
	type AnalyticsQuery,
	type AnalyticsResult,
	type AnalyticsRow,
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type Granularity,
	type MetricKey,
	type MetricValue,
	type MetricValues,
} from '../core/contract'
export { formatMetricValue, type MetricFormat } from '../fields/format'
export {
	ANALYTICS_ERROR_CODES,
	type AnalyticsError,
	type AnalyticsErrorCode,
	readErrorCode,
	readResponseError,
} from '../plugin/errors'
export {
	analyticsRoutes,
	DEFAULT_ROUTE_BASE,
	type RouteBase,
	type RoutePaths,
	type RoutesConfigSource,
	routePaths,
} from '../plugin/routes'
export { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
