import type { Config, Payload } from 'payload'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
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
import { flushBatch } from './ingest/flushBatch'
import type { StoredEvent } from './ingest/normalizeEvent'
import { createWriteBuffer, type WriteBuffer } from './ingest/writeBuffer'
import { pruneEventsTask } from './retention/pruneTask'

export interface NativeOptions {
	geoResolver?: GeoResolver
	geoDbPath?: string
	ingestPath?: string
	retentionDays?: number
	/** Opt-in in-process write batching. `true` uses defaults (maxSize 50, maxAgeMs 2000). */
	buffer?: boolean | { maxSize?: number; maxAgeMs?: number }
}

export type NativeAdapter = AnalyticsAdapter & { flush: () => Promise<void> }

const metrics: ReadonlySet<MetricKey> = new Set([
	'pageviews',
	'visitors',
	'sessions',
	'events',
	'avgDuration',
])
const dimensions: ReadonlySet<DimensionKey> = new Set(['page', 'country'])

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

type RollupDoc = {
	path: string
	dimvalue: string
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
}

interface Acc {
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
}

const emptyAcc = (): Acc => ({ pageviews: 0, events: 0, durationMs: 0, visitors: 0, sessions: 0 })

const add = (acc: Acc, d: RollupDoc): void => {
	acc.pageviews += d.pageviews
	acc.events += d.events
	acc.durationMs += d.durationMs
	acc.visitors += d.visitors
	acc.sessions += d.sessions
}

const selectMetrics = (acc: Acc, wanted: MetricKey[]): Partial<Record<MetricKey, number>> => {
	const out: Partial<Record<MetricKey, number>> = {}
	if (wanted.includes('pageviews')) out.pageviews = acc.pageviews
	if (wanted.includes('events')) out.events = acc.events
	if (wanted.includes('visitors')) out.visitors = acc.visitors
	if (wanted.includes('sessions')) out.sessions = acc.sessions
	if (wanted.includes('avgDuration')) {
		out.avgDuration = acc.pageviews > 0 ? Math.round(acc.durationMs / acc.pageviews) : 0
	}
	return out
}

export function native(options: NativeOptions = {}): NativeAdapter {
	const geoResolver =
		options.geoResolver ??
		(options.geoDbPath
			? composeGeoResolvers(platformHeaderResolver, maxmindResolver({ dbPath: options.geoDbPath }))
			: platformHeaderResolver)
	let payloadRef: Payload | null = null
	let buffer: WriteBuffer<StoredEvent> | null = null

	const readRollups = async (
		payload: Payload,
		where: Record<string, unknown>
	): Promise<RollupDoc[]> => {
		const { docs } = await payload.find({
			collection: ROLLUPS_SLUG as never,
			where: where as never,
			limit: 100_000,
			pagination: false,
		})
		return docs as unknown as RollupDoc[]
	}

	return {
		id: 'native',
		label: 'Native (Payload)',
		capabilities,
		isConfigured: () => true,
		flush: () => buffer?.flush() ?? Promise.resolve(),
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
					handler: makeIngestHandler(geoResolver, () => buffer),
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
				if (options.buffer) {
					const cfg = options.buffer === true ? {} : options.buffer
					buffer = createWriteBuffer<StoredEvent>({
						maxSize: cfg.maxSize ?? 50,
						maxAgeMs: cfg.maxAgeMs ?? 2000,
						onFlush: (batch) => flushBatch(p, batch),
						onError: (error) => {
							p.logger.error({ err: error, msg: 'analytics: write buffer flush failed' })
						},
					})
				}
			}
		},
		async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
			if (!payloadRef) {
				throw new Error('analytics: native adapter queried before init')
			}
			const fetchedAt = q.dateRange.end.toISOString()
			const periodWhere = {
				greater_than_equal: q.dateRange.start.toISOString(),
				less_than_equal: q.dateRange.end.toISOString(),
			}
			const dim = q.dimensions?.find((d) => dimensions.has(d))

			// Distinct metrics (visitors/sessions) must not be summed across breakdown rows.
			// Totals always come from the non-dimensioned aggregate row. A dimensioned query
			// reports site-wide totals (path=''), a plain query uses the path-scoped row.
			const totalsPath = dim ? '' : (q.path ?? '')
			const totalsAcc = emptyAcc()
			for (const d of await readRollups(payloadRef, {
				granularity: { equals: 'day' },
				dimension: { equals: '' },
				path: { equals: totalsPath },
				period: periodWhere,
			})) {
				add(totalsAcc, d)
			}
			const totals = selectMetrics(totalsAcc, q.metrics)

			if (!dim) {
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'native', fetchedAt } }
			}

			const breakdownWhere =
				dim === 'page'
					? {
							granularity: { equals: 'day' },
							dimension: { equals: '' },
							path: { not_equals: '' },
							period: periodWhere,
						}
					: {
							granularity: { equals: 'day' },
							dimension: { equals: 'country' },
							path: { equals: '' },
							period: periodWhere,
						}
			const groups = new Map<string, Acc>()
			for (const d of await readRollups(payloadRef, breakdownWhere)) {
				const value = dim === 'page' ? d.path : d.dimvalue
				let acc = groups.get(value)
				if (!acc) {
					acc = emptyAcc()
					groups.set(value, acc)
				}
				add(acc, d)
			}
			let rows: AnalyticsRow[] = [...groups].map(([value, acc]) => ({
				dimensions: { [dim]: value } as Partial<Record<DimensionKey, string>>,
				metrics: selectMetrics(acc, q.metrics),
			}))
			const sortMetric = q.order?.metric ?? 'pageviews'
			const direction = (q.order?.direction ?? 'desc') === 'asc' ? 1 : -1
			rows.sort((a, b) => ((a.metrics[sortMetric] ?? 0) - (b.metrics[sortMetric] ?? 0)) * direction)
			if (q.limit) {
				rows = rows.slice(0, q.limit)
			}
			return { rows, totals, meta: { provider: 'native', fetchedAt } }
		},
	}
}
