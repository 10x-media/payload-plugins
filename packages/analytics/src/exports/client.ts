'use client'

export { BarList, type BarListHeaders, type BarListProps } from '../charts/BarList'
export type { BarDatum } from '../charts/bars'
export { TrendChart, type TrendChartProps, type TrendPoint } from '../charts/TrendChart'
export type {
	CapabilityRequirement,
	FilterPair,
	SerializedCapabilities,
} from '../core/capabilities'
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
export type { FilterDimensionSelectFieldProps } from '../fields/config/FilterDimensionSelectField'
export type { FilterOperatorSelectFieldProps } from '../fields/config/FilterOperatorSelectField'
export {
	FilterValueField,
	type FilterValueFieldProps,
} from '../fields/config/FilterValueField'
export type { SourcesResponse, WireSource } from '../fields/config/fetchSources'
export type { MetricSelectFieldProps } from '../fields/config/MetricSelectField'
export {
	FilterDimensionSelectField,
	FilterOperatorSelectField,
	GoalSelectField,
	MetricSelectField,
	SourceSelectField,
} from '../fields/config/retiredPickers'
export {
	type AnalyticsSources,
	useAnalyticsSources,
} from '../fields/config/useAnalyticsSources'
export {
	type FilterCapabilities,
	useFilterCapabilities,
} from '../fields/config/useFilterCapabilities'
export type { DateRangeFieldOptions, DateRangePickerAppearance } from '../fields/dateRange/types'
export { DateRangeField, type DateRangeFieldComponentProps } from '../fields/dateRange/ui'
export { formatMetricValue, type MetricFormat } from '../fields/format'
export type { GoalAmountFieldOptions } from '../goals/amountField'
export type { GoalsResponse, WireGoal } from '../goals/fetchGoals'
export { GoalAmountField, type GoalAmountFieldProps } from '../goals/GoalAmountField'
export type { GoalSource } from '../goals/resolver'
export { type AnalyticsGoals, useAnalyticsGoals } from '../goals/useAnalyticsGoals'
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
export {
	buildQueryUrl,
	type FetchQueryInit,
	fetchQuery,
	QueryFetchError,
	type QueryRequest,
	type RefreshRequest,
	type RefreshResponse,
	refreshCache,
} from '../query/fetchQuery'
export type {
	ItemLabels,
	QueryResponse,
	QuerySourceRef,
	SerializedAnalyticsQuery,
} from '../query/response'
export { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
export { Card, type CardProps } from '../ui/components/Card'
export {
	type ChartDataRow,
	ChartDataTable,
	type ChartDataTableProps,
} from '../ui/components/ChartDataTable'
export {
	DataTable,
	type DataTableColumn,
	type DataTableProps,
	type DataTableRow,
	type SortDirection,
} from '../ui/components/DataTable'
export { MetricCard, type MetricCardProps } from '../ui/components/MetricCard'
export type { RequestFailure } from '../ui/data/request'
export type { RequestState } from '../ui/data/useRequest'
export { AnalyticsNavLink, type AnalyticsNavLinkProps } from '../view/AnalyticsNavLink'
export { AnalyticsViewClient } from '../view/AnalyticsViewClient'
export type { CountryFlagProps, CountryFlags, HostCountryFlag } from '../view/CountryFlag'
export type { BreakdownTab, DayRange } from '../view/gating'
export { Toolbar } from '../view/sections/Toolbar'
export { VIEW_LIMITS, type ViewLimit, type ViewState } from '../view/state'
export type { QueryState, ViewQueries } from '../view/useViewQueries'
export { ViewRoot, type ViewRootProps } from '../view/ViewRoot'
export {
	ViewBreakdowns,
	ViewGoals,
	ViewOverview,
	ViewRealtime,
	ViewTrend,
} from '../view/ViewSections'
export {
	type ReadonlyViewGate,
	useView,
	type ViewAnswers,
	type ViewContextValue,
	type ViewRefresh,
} from '../view/viewContext'
export type {
	AnalyticsViewClientProps,
	ViewEndpoints,
	ViewGoal,
	ViewScopes,
} from '../view/viewProps'
export { RealtimeCounter, type RealtimeCounterProps } from '../widgets/RealtimeCounter'
export type { RealtimePoint } from '../widgets/readForWidgetRealtime'
export type { ReadNotices } from '../widgets/readMeta'
