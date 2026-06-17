import type { BetaAnalyticsDataClient, protos } from '@google-analytics/data'
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

export interface Ga4Config {
	/** GA4 property id (numeric), e.g. '123456789'. */
	propertyId: string
	/** Service-account credentials. */
	credentials: { client_email: string; private_key: string }
	/** GCP project id; inferred from the credentials when omitted. */
	projectId?: string
}

const METRIC_MAP: Partial<Record<MetricKey, string>> = {
	pageviews: 'screenPageViews',
	visitors: 'totalUsers',
	visits: 'sessions',
	sessions: 'sessions',
	bounceRate: 'bounceRate',
	avgDuration: 'averageSessionDuration',
	events: 'eventCount',
	conversions: 'keyEvents',
	revenue: 'totalRevenue',
}

const DIMENSION_MAP: Partial<Record<DimensionKey, string>> = {
	page: 'pagePath',
	referrer: 'pageReferrer',
	source: 'sessionSource',
	medium: 'sessionMedium',
	campaign: 'sessionCampaignName',
	utmSource: 'sessionSource',
	utmMedium: 'sessionMedium',
	utmCampaign: 'sessionCampaignName',
	device: 'deviceCategory',
	browser: 'browser',
	os: 'operatingSystem',
	country: 'countryId',
	region: 'region',
	city: 'city',
	language: 'language',
	event: 'eventName',
}

const metrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
const dimensions: ReadonlySet<DimensionKey> = new Set(Object.keys(DIMENSION_MAP) as DimensionKey[])

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	// GA4 bills a token quota (200k/day, 40k/hr), so bias hard to caching.
	rateLimit: { maxConcurrent: 10, quotaModel: 'tokens', readsCountAsUsage: true },
	recommendedTtl: { realtime: 300, aggregate: 21600 },
}

// GA4 returns bounceRate as a 0..1 ratio and averageSessionDuration in seconds; the
// contract uses a 0..100 percentage and milliseconds.
const toContractValue = (metric: MetricKey, raw: number): number => {
	if (metric === 'avgDuration') {
		return Math.round(raw * 1000)
	}
	if (metric === 'bounceRate') {
		return Math.round(raw * 100)
	}
	return raw
}

export function ga4(config: Ga4Config): AnalyticsAdapter {
	let clientPromise: Promise<BetaAnalyticsDataClient> | undefined

	const getClient = (): Promise<BetaAnalyticsDataClient> => {
		if (!clientPromise) {
			clientPromise = (async () => {
				let mod: typeof import('@google-analytics/data')
				try {
					mod = await import('@google-analytics/data')
				} catch {
					throw new Error(
						'@10x-media/analytics: the GA4 adapter requires the optional peer dependency "@google-analytics/data". Install it with: pnpm add @google-analytics/data'
					)
				}
				return new mod.BetaAnalyticsDataClient({
					credentials: config.credentials,
					projectId: config.projectId,
				})
			})()
		}
		return clientPromise
	}

	return {
		id: 'ga4',
		label: 'Google Analytics 4',
		capabilities,
		isConfigured: () =>
			Boolean(
				config.propertyId && config.credentials?.client_email && config.credentials?.private_key
			),
		// The gRPC SDK's gax CallOptions has no AbortSignal field, so ctx.signal cannot be
		// forwarded; gax cancellation uses the call's own handle, not our signal.
		async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = q.dateRange.end.toISOString()
			const wanted = q.metrics.filter((m) => METRIC_MAP[m])
			// Several contract metrics alias one GA4 metric (visits and sessions both map to
			// "sessions"); dedupe before sending and read each contract metric back from its
			// provider key's position.
			const providerMetrics = [...new Set(wanted.map((m) => METRIC_MAP[m] as string))]
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const providerDims = [...new Set(dims.map((d) => DIMENSION_MAP[d] as string))]

			const request: protos.google.analytics.data.v1beta.IRunReportRequest = {
				property: `properties/${config.propertyId}`,
				dateRanges: [
					{
						startDate: q.dateRange.start.toISOString().slice(0, 10),
						endDate: q.dateRange.end.toISOString().slice(0, 10),
					},
				],
				metrics: providerMetrics.map((name) => ({ name })),
				...(providerDims.length ? { dimensions: providerDims.map((name) => ({ name })) } : {}),
				...(q.path
					? {
							dimensionFilter: {
								filter: {
									fieldName: 'pagePath',
									stringFilter: { matchType: 'EXACT', value: q.path },
								},
							},
						}
					: {}),
				...(q.limit ? { limit: q.limit } : {}),
			}

			const client = await getClient()
			const [response] = await client.runReport(request)

			const readRow = (
				row: protos.google.analytics.data.v1beta.IRow
			): Partial<Record<MetricKey, number>> => {
				const out: Partial<Record<MetricKey, number>> = {}
				for (const m of wanted) {
					const idx = providerMetrics.indexOf(METRIC_MAP[m] as string)
					out[m] = toContractValue(m, Number(row.metricValues?.[idx]?.value ?? 0))
				}
				return out
			}

			if (!dims.length) {
				const row = response.rows?.[0]
				const totals = row ? readRow(row) : {}
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'ga4', fetchedAt } }
			}

			const rows: AnalyticsRow[] = (response.rows ?? []).map((row) => {
				const dimValues: Partial<Record<DimensionKey, string>> = {}
				for (const d of dims) {
					const idx = providerDims.indexOf(DIMENSION_MAP[d] as string)
					dimValues[d] = row.dimensionValues?.[idx]?.value ?? ''
				}
				return { dimensions: dimValues, metrics: readRow(row) }
			})
			return { rows, totals: undefined, meta: { provider: 'ga4', fetchedAt } }
		},
	}
}
