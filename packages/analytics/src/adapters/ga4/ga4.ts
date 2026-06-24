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
import { dayIso } from '../series'

export interface Ga4Config {
	/** GA4 property id (numeric), e.g. '123456789'. */
	propertyId: string
	/** Service-account credentials. */
	credentials: { client_email: string; private_key: string }
	/** GCP project id; inferred from the credentials when omitted. */
	projectId?: string
	/** Maximum days of historical data. Defaults to 425 (GA4's rolling-window limit). Pass null to disable clamping. */
	maxLookbackDays?: number | null
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

const ga4Metrics: ReadonlySet<MetricKey> = new Set(Object.keys(METRIC_MAP) as MetricKey[])
const ga4Dimensions: ReadonlySet<DimensionKey> = new Set(
	Object.keys(DIMENSION_MAP) as DimensionKey[]
)

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
	const maxLookbackDays = config.maxLookbackDays !== undefined ? config.maxLookbackDays : 425

	const capabilities: AnalyticsCapabilities = {
		perPageQuery: true,
		realtime: false,
		comparison: false,
		minGranularity: 'day',
		maxLookbackDays,
		metrics: ga4Metrics,
		dimensions: ga4Dimensions,
		batchPageReport: true,
		rateLimit: { maxConcurrent: 10, quotaModel: 'tokens', readsCountAsUsage: true },
		recommendedTtl: { realtime: 300, aggregate: 21600 },
	}

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
			const providerMetrics = [...new Set(wanted.map((m) => METRIC_MAP[m] as string))]
			const dims = (q.dimensions ?? []).filter((d) => DIMENSION_MAP[d])
			const providerDims = [...new Set(dims.map((d) => DIMENSION_MAP[d] as string))]

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

			const baseRequest: protos.google.analytics.data.v1beta.IRunReportRequest = {
				property: `properties/${config.propertyId}`,
				dateRanges: [
					{
						startDate: q.dateRange.start.toISOString().slice(0, 10),
						endDate: q.dateRange.end.toISOString().slice(0, 10),
					},
				],
				metrics: providerMetrics.map((name) => ({ name })),
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
			}

			const client = await getClient()

			if (q.granularity === 'day' && !dims.length) {
				const [response] = await client.runReport({
					...baseRequest,
					dimensions: [{ name: 'date' }],
					metricAggregations: [
						'TOTAL',
					] as unknown as protos.google.analytics.data.v1beta.MetricAggregation[],
					orderBys: [{ dimension: { dimensionName: 'date' } }],
				})
				const rows: AnalyticsRow[] = []
				for (const row of response.rows ?? []) {
					const ymd = row.dimensionValues?.[0]?.value ?? ''
					const ts = dayIso(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`)
					if (ts) {
						rows.push({ timestamp: ts, metrics: readRow(row) })
					}
				}
				const totalsRow = response.totals?.[0]
				const totals = totalsRow ? readRow(totalsRow) : {}
				return { rows, totals, meta: { provider: 'ga4', fetchedAt } }
			}

			const [response] = await client.runReport({
				...baseRequest,
				...(providerDims.length ? { dimensions: providerDims.map((name) => ({ name })) } : {}),
				...(q.limit ? { limit: q.limit } : {}),
			})

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
