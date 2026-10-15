/**
 * The adapter contract an adapter entry's factory returns, re-exported type-only by each such
 * entry so it declares every type its signatures reach.
 */
export type {
	CaptureSupport,
	ProxyDescriptor,
	ProxyRoute,
	ProxyRouteKind,
} from '../../core/capture'
export type {
	AdapterContext,
	AdapterLabelArgs,
	AdapterRegisterContext,
	AdapterSchemaContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DateRange,
	DIMENSION_KEYS,
	DimensionKey,
	FILTER_OPERATORS,
	FilterOperator,
	FilterOperatorMap,
	Granularity,
	MetricKey,
	MetricReach,
	MetricSemantics,
	MetricValue,
	MetricValues,
	RateLimitDescriptor,
	SourceErrorKind,
	VisitorCounting,
} from '../../core/contract'
export type { FetchInit, FetchLike } from '../../core/fetch'
export type { AdapterJobs, AnalyticsTaskName, ScheduledTask, TASK_NAMES } from '../../core/jobs'
export type {
	AnalyticsSdks,
	Ga4Client,
	Ga4ClientOptions,
	Ga4ReportResponse,
	Ga4ReportRow,
	Ga4Sdk,
	MaxmindReader,
	MaxmindSdk,
} from '../../core/sdks'
export type {
	IngestHostnameResolver,
	ServerEventInput,
	ServerTrack,
	ServerTrackIdentity,
	ServerTrackOptions,
} from '../../core/serverEvent'
export type { AdapterLabelOption } from '../../core/sourceLabel'
export type { CurrencyConverter } from '../../goals/currency'
export type { BrowserAmounts, OrderSignatureMode } from '../../goals/match'
export type { Goal } from '../../goals/types'
export type { RawEventInput } from '../../native/ingest/normalizeEvent'
export type { HitType } from '../../native/store/types'
export type { TrustedPlatform } from '../../net/platform'
export type { RouteBase, RoutePaths } from '../../plugin/routes'
export type {
	CaptureClientKind,
	CaptureSlot,
	CaptureSnippet,
	GoalMatch,
	SnippetScript,
	TrackerGoal,
	TrackerSlotConfig,
} from '../../tracker/config'
