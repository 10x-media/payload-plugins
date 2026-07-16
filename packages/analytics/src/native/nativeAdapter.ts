import type { Config, Payload } from 'payload'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	DimensionKey,
	MetricKey,
} from '../core/contract'
import { EVENTS_SLUG, eventsCollection } from './collections/events'
import { ROLLUPS_SLUG, rollupsCollection } from './collections/rollups'
import { seenCollection } from './collections/seen'
import { composeGeoResolvers } from './geo/composeGeoResolvers'
import { type GeoResolver, platformHeaderResolver } from './geo/geoResolver'
import { maxmindResolver } from './geo/maxmindResolver'
import { makeIngestHandler } from './ingest/endpoint'
import { flushBatch } from './ingest/flushBatch'
import type { StoredEvent } from './ingest/normalizeEvent'
import { createWriteBuffer, type WriteBuffer } from './ingest/writeBuffer'
import { buildRealtime, type RealtimeEvent } from './realtime/buildRealtime'
import { pruneEventsTask } from './retention/pruneTask'
import {
	type Acc,
	add,
	emptyAcc,
	type RollupDoc,
	selectMetrics,
	seriesFromRollups,
} from './rollupAcc'

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
const dimensions: ReadonlySet<DimensionKey> = new Set(['page', 'country', 'source', 'device'])

const REALTIME_EVENT_LIMIT = 50_000

const baseCapabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: true,
	realtimeWindowMinutes: 60,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 10, aggregate: 300 },
}

export function native(options: NativeOptions = {}): NativeAdapter {
	const geoResolver =
		options.geoResolver ??
		(options.geoDbPath
			? composeGeoResolvers(platformHeaderResolver, maxmindResolver({ dbPath: options.geoDbPath }))
			: platformHeaderResolver)
	// Per-instance copy: register() flips scopedQueries when the install is scoped.
	const capabilities: AnalyticsCapabilities = { ...baseCapabilities }
	let payloadRef: Payload | null = null
	let buffer: WriteBuffer<StoredEvent> | null = null
	let scoped = false

	const scopeWhere = (q: AnalyticsQuery): Record<string, unknown> =>
		scoped && q.scope !== undefined ? { scope: { equals: q.scope } } : {}

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
		register(config: Config, context) {
			scoped = context?.scoped ?? false
			if (scoped) {
				capabilities.scopedQueries = true
			}
			config.collections = [
				...(config.collections ?? []),
				eventsCollection(scoped),
				rollupsCollection(scoped),
				seenCollection(),
			]
			config.endpoints = [
				...(config.endpoints ?? []),
				{
					method: 'post',
					path: options.ingestPath ?? '/analytics/ingest',
					handler: makeIngestHandler(geoResolver, () => buffer, {
						scope: scoped ? context?.resolveScope : undefined,
						timezone: context?.resolveTimezone,
					}),
				},
			]
			if (options.retentionDays && options.retentionDays > 0) {
				config.jobs = {
					...config.jobs,
					tasks: [...(config.jobs?.tasks ?? []), pruneEventsTask(options.retentionDays)],
				}
			}
			const prevOnInit = config.onInit
			// payloadRef is set before the app's own onInit so consumer init code can
			// already query the native adapter.
			config.onInit = async (p) => {
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
				await prevOnInit?.(p)
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
			const totalsDocs = await readRollups(payloadRef, {
				granularity: { equals: 'day' },
				dimension: { equals: '' },
				path: { equals: totalsPath },
				period: periodWhere,
				...scopeWhere(q),
			})
			const totalsAcc = emptyAcc()
			for (const d of totalsDocs) {
				add(totalsAcc, d)
			}
			const totals = selectMetrics(totalsAcc, q.metrics)

			if (!dim) {
				if (q.granularity === 'day') {
					return {
						rows: seriesFromRollups(totalsDocs, q.metrics, q.timezone),
						totals,
						meta: { provider: 'native', fetchedAt },
					}
				}
				return { rows: [{ metrics: totals }], totals, meta: { provider: 'native', fetchedAt } }
			}

			const breakdownWhere =
				dim === 'page'
					? {
							granularity: { equals: 'day' },
							dimension: { equals: '' },
							path: { not_equals: '' },
							period: periodWhere,
							...scopeWhere(q),
						}
					: {
							granularity: { equals: 'day' },
							dimension: { equals: dim },
							path: { equals: '' },
							period: periodWhere,
							...scopeWhere(q),
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
		async realtime(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			if (!payloadRef) {
				throw new Error('analytics: native adapter queried before init')
			}
			const fetchedAt = q.dateRange.end.toISOString()
			const { docs } = await payloadRef.find({
				collection: EVENTS_SLUG as never,
				where: {
					timestamp: {
						greater_than_equal: q.dateRange.start.toISOString(),
						less_than_equal: q.dateRange.end.toISOString(),
					},
					...scopeWhere(q),
				} as never,
				// Newest-first under a hard cap: if a very busy site has more events than the
				// cap in the window, keep the most recent activity rather than the oldest.
				// Unbounded accuracy via DB-side aggregation is deferred to the hardening spec.
				limit: REALTIME_EVENT_LIMIT,
				pagination: false,
				depth: 0,
				sort: '-timestamp',
			})
			const events = docs as unknown as RealtimeEvent[]
			const { rows, totals } = buildRealtime(events, q.dateRange, q.metrics)
			return { rows, totals, meta: { provider: 'native', fetchedAt } }
		},
	}
}
