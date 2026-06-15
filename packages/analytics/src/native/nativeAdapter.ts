import type { Config, Payload } from 'payload'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	DimensionKey,
	MetricKey,
} from '../core/contract'
import { eventsCollection } from './collections/events'
import { ROLLUPS_SLUG, rollupsCollection } from './collections/rollups'
import { seenCollection } from './collections/seen'
import { composeGeoResolvers } from './geo/composeGeoResolvers'
import { type GeoResolver, platformHeaderResolver } from './geo/geoResolver'
import { maxmindResolver } from './geo/maxmindResolver'
import { makeIngestHandler } from './ingest/endpoint'
import { pruneEventsTask } from './retention/pruneTask'

export interface NativeOptions {
	geoResolver?: GeoResolver
	geoDbPath?: string
	ingestPath?: string
	retentionDays?: number
}

const metrics: ReadonlySet<MetricKey> = new Set(['pageviews', 'events', 'avgDuration'])
const dimensions: ReadonlySet<DimensionKey> = new Set(['page'])

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
}

type RollupDoc = { pageviews: number; events: number; durationMs: number }

export function native(options: NativeOptions = {}): AnalyticsAdapter {
	const geoResolver =
		options.geoResolver ??
		(options.geoDbPath
			? composeGeoResolvers(platformHeaderResolver, maxmindResolver({ dbPath: options.geoDbPath }))
			: platformHeaderResolver)
	let payloadRef: Payload | null = null

	return {
		id: 'native',
		label: 'Native (Payload)',
		capabilities,
		isConfigured: () => true,
		register(config: Config) {
			config.collections = [
				...(config.collections ?? []),
				eventsCollection(),
				rollupsCollection(),
				seenCollection(),
			]
			config.endpoints = [
				...(config.endpoints ?? []),
				{
					method: 'post',
					path: options.ingestPath ?? '/analytics/ingest',
					handler: makeIngestHandler(geoResolver),
				},
			]
			if (options.retentionDays && options.retentionDays > 0) {
				config.jobs = {
					...config.jobs,
					tasks: [...(config.jobs?.tasks ?? []), pruneEventsTask(options.retentionDays)],
				}
			}
			const prevOnInit = config.onInit
			config.onInit = async (p) => {
				await prevOnInit?.(p)
				payloadRef = p
			}
		},
		async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
			if (!payloadRef) {
				throw new Error('analytics: native adapter queried before init')
			}
			const where: Record<string, unknown> = {
				granularity: { equals: 'day' },
				dimension: { equals: '' },
				period: {
					greater_than_equal: q.dateRange.start.toISOString(),
					less_than_equal: q.dateRange.end.toISOString(),
				},
			}
			if (q.path) {
				where.path = { equals: q.path }
			}
			const { docs } = await payloadRef.find({
				collection: ROLLUPS_SLUG as never,
				where: where as never,
				limit: 100_000,
				pagination: false,
			})
			let pageviews = 0
			let events = 0
			let durationMs = 0
			for (const d of docs as unknown as RollupDoc[]) {
				pageviews += d.pageviews
				events += d.events
				durationMs += d.durationMs
			}
			const totals: AnalyticsResult['totals'] = {}
			if (q.metrics.includes('pageviews')) {
				totals.pageviews = pageviews
			}
			if (q.metrics.includes('events')) {
				totals.events = events
			}
			if (q.metrics.includes('avgDuration')) {
				totals.avgDuration = pageviews > 0 ? Math.round(durationMs / pageviews) : 0
			}
			return {
				rows: [{ metrics: totals }],
				totals,
				meta: { provider: 'native', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
}
