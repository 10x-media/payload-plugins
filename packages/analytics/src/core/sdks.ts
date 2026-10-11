import { hasMethods, isRecord, onlyKeys } from './values'

/**
 * What the GA4 adapter hands the Data API client it builds. A type alias rather than an
 * interface: the SDK's `ClientOptions` carries an index signature, which an interface never meets.
 */
export type Ga4ClientOptions = {
	credentials: { client_email: string; private_key: string }
	projectId?: string
}

/**
 * One row of a GA4 report, as far as the adapter reads it.
 *
 * @beta
 */
export interface Ga4ReportRow {
	dimensionValues?: Array<{ value?: string | null }> | null
	metricValues?: Array<{ value?: string | null }> | null
}

/**
 * A GA4 report as far as the adapter reads it, written out so no SDK type is needed.
 *
 * @beta
 */
export interface Ga4ReportResponse {
	rows?: Ga4ReportRow[] | null
	totals?: Ga4ReportRow[] | null
	metadata?: {
		samplingMetadatas?: unknown[] | null
		currencyCode?: string | null
	} | null
}

/**
 * The Data API client the GA4 adapter calls: the SDK's `BetaAnalyticsDataClient` is one.
 *
 * @beta
 */
export interface Ga4Client {
	runReport(
		request: object,
		options?: { timeout?: number; retry?: null }
	): Promise<[Ga4ReportResponse, ...unknown[]]>
	close?(): Promise<void>
}

/**
 * The part of `@google-analytics/data` the GA4 adapter uses: pass the package's own class,
 * `{ BetaAnalyticsDataClient }`. Written structurally, so an install without the package compiles.
 */
export interface Ga4Sdk {
	BetaAnalyticsDataClient: new (options: Ga4ClientOptions) => Ga4Client
}

/** An open MaxMind database: what it answers for one address is read field by field. */
export interface MaxmindReader {
	get(address: string): unknown
}

/**
 * The part of `maxmind` the geo resolver uses: pass the package's own `{ open }`. Written
 * structurally, so an install without the package compiles.
 */
export interface MaxmindSdk {
	open(database: string): Promise<MaxmindReader>
}

/**
 * Optional packages handed to the plugin rather than loaded by it: a runtime-loaded package escapes
 * a standalone or serverless build's file tracing.
 */
export interface AnalyticsSdks {
	/** `{ BetaAnalyticsDataClient }` from `@google-analytics/data`, for every GA4 source. */
	ga4?: Ga4Sdk
	/** `{ open }` from `maxmind`, for the native engine's MaxMind geo lookups. */
	maxmind?: MaxmindSdk
}

/** `{ BetaAnalyticsDataClient }` as `sdks.ga4` and `ga4({ sdk })` take it. */
export const isGa4Sdk = (value: unknown): value is Ga4Sdk =>
	hasMethods(value, ['BetaAnalyticsDataClient'])

/** `{ open }` as `sdks.maxmind` and `maxmindResolver({ sdk })` take it. */
export const isMaxmindSdk = (value: unknown): value is MaxmindSdk => hasMethods(value, ['open'])

/** `sdks`, checked at boot: a wrong shape would otherwise fail the first read instead. */
export const resolveSdks = (option: unknown): AnalyticsSdks => {
	if (option === undefined) {
		return {}
	}
	if (!isRecord(option) || Array.isArray(option)) {
		throw new Error(
			'analytics: sdks must be an object such as { ga4: { BetaAnalyticsDataClient } }'
		)
	}
	onlyKeys(option, ['ga4', 'maxmind'], 'sdks')
	const { ga4, maxmind } = option
	if (ga4 !== undefined && !isGa4Sdk(ga4)) {
		throw new Error(
			"analytics: sdks.ga4 must be { BetaAnalyticsDataClient }, imported from '@google-analytics/data'"
		)
	}
	if (maxmind !== undefined && !isMaxmindSdk(maxmind)) {
		throw new Error("analytics: sdks.maxmind must be { open }, imported from 'maxmind'")
	}
	return { ...(ga4 === undefined ? {} : { ga4 }), ...(maxmind === undefined ? {} : { maxmind }) }
}
