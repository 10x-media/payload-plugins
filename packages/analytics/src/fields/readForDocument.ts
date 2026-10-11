import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf, SYSTEM } from '../access/principal'
import { bindsItems, type ReportMode } from '../binding/report'
import { resolveHostname, resolvePathCached } from '../binding/resolvePath'
import type { BindingContext, BindingDoc, ResolvedBinding } from '../binding/types'
import {
	fillSeries,
	type SeriesGranularity,
	type SeriesPoint,
	seriesGranularityFor,
} from '../charts/series'
import { metricReaches, satisfiesCapabilities, supportsFilter } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	DateRange,
	DimensionKey,
	MetricKey,
	MetricValues,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { readAsAsked, servedName } from '../core/metricAliases'
import { type ReadContext, resolveReadContext } from '../core/scopedRead'
import { ITEM_CLICK_EVENT } from '../goals/constants'
import { itemRefOf } from '../items/ref'
import { resolveDocumentScope } from '../plugin/documentScopes'
import { goalSlugsFor } from '../plugin/goalHint'
import { type AnalyticsRuntime, getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { exceedsRangeCap } from '../query/limits'
import { readFailureOf } from '../surfacing/classifyError'
import { PEEK_BUDGET_MS, type ReadOptions } from '../surfacing/engine'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { comparisonWindow } from '../widgets/prepareWidgetRead'
import { mergeNotices, type ReadNotices, readMeta } from '../widgets/readMeta'
import { scopeFromDocument } from './documentScope'
import { ITEM_READ_METRICS } from './itemReport'

/**
 * `no-access` is about the reader, never a page without traffic; `unavailable` a source that
 * cannot read the document at all; `busy` a failure for now, which a retry can fix.
 */
export type FieldReadStatus =
	| 'ok'
	| 'no-path'
	| 'not-bound'
	| 'not-configured'
	| 'no-access'
	| 'no-scope'
	| 'unavailable'
	| 'busy'
	| 'invalid'
	| 'range-too-long'
	| 'misconfigured'
	| 'host-refused'

/** One ranked value of a dimension, for this document's page only. */
export interface FieldBreakdownRow {
	value: string
	metric: number
}

/**
 * A dimension ranked for this page. The read is a `page eq <path>` filter rather than the
 * per-page report, because that is the only shape a source can group another dimension by.
 */
export interface FieldBreakdown extends Partial<ReadNotices> {
	dimension: DimensionKey
	/** The metric the rows are ranked by; `visitors` wherever the source serves it. */
	metric: MetricKey
	rows: FieldBreakdownRow[]
	/** The source that answered, for the value labels that read differently per provider. */
	provider?: string
}

export interface FieldReadResult {
	status: FieldReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	/** The headline numbers answered but a comparison, series or list did not: try again for it. */
	incomplete?: true
	/** `item` when the read was about the document as a content item, absent for its page. */
	report?: 'item'
	adapterId: string
	dateRange: DateRange
	/** The reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone: string
	/** An average with nothing to average over reads `null`; render it as no data, not zero. */
	metrics: MetricValues
	/** Requested metrics the adapter supports, in request order; the set actually read. */
	supportedMetrics: MetricKey[]
	/** Requested metrics the adapter cannot serve, dropped from the read. */
	droppedMetrics: MetricKey[]
	/** Previous-window totals, present only when comparison was requested and supported. */
	previousMetrics?: MetricValues
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
	/** Series for the first supported metric, present only when requested. */
	points?: SeriesPoint[]
	/**
	 * The bucket `points` carry. A window of a day or two is charted by hour, so `day` there
	 * says the source serves no hourly rows and the panel has a single value, not a line.
	 */
	seriesGranularity?: SeriesGranularity
	/** The source counts live visitors, so the panel may poll for this page's own count. */
	realtime?: boolean
	/** One entry per requested dimension the source can rank for a single page. */
	breakdowns?: FieldBreakdown[]
	/** What the totals' and the series' reads say about their numbers. */
	notices?: ReadNotices
	/**
	 * Reader may not read into the document's scope (or is no member of the request's), so the
	 * read never ran. Rendered as `no-access`; the endpoint answers `untrusted_scope`.
	 */
	untrustedScope?: boolean
}

/**
 * Without `scope` the read takes the document's scope (binding `scopeField`) else the request's,
 * gated as endpoints gate it; a given `scope` is already cleared, or a job's under `SYSTEM`.
 */
export type ReadForFieldArgs = ReadPrincipal & {
	req: PayloadRequest
	collectionSlug: string
	data: BindingDoc
	metrics: MetricKey[]
	timeframe: TimeframePreset
	/** Overrides the preset window (custom range). */
	range?: DateRange
	adapterId?: string
	now: Date
	/**
	 * Reporting timezone the caller already resolved, reused rather than resolved again so
	 * a caller-supplied `range` is read in the very timezone it was interpreted in.
	 */
	timezone?: string
	/** Also read the previous comparable window when the adapter supports comparison. */
	compare?: boolean
	/** Also read a series for the first supported metric, bucketed to suit the window. */
	series?: boolean
	/**
	 * Metrics the caller added speculatively rather than asked for, so a source that serves none
	 * of them is not worth a warning on every render.
	 */
	optionalMetrics?: MetricKey[]
	/** Rank these dimensions for the document's own page; each one the source cannot is skipped. */
	dimensions?: DimensionKey[]
	/** Rows per breakdown. Default 5. */
	limit?: number
	/**
	 * `item` reads the document as content shown on other pages: its views, clicks and outcomes,
	 * wherever it appeared. Absent, or `page`, reads the document's own page.
	 */
	report?: ReportMode
}

/** Rows per breakdown block: a card-sized list, not a table. */
const DEFAULT_BREAKDOWN_LIMIT = 5

/** The ranked lists a panel read, and whether any it could rank failed to answer. */
interface RankedLists {
	blocks: FieldBreakdown[]
	failed: boolean
}

const NO_LISTS: RankedLists = { blocks: [], failed: false }

/** The numbers of a read that never ran, fresh per result so no two results share an array. */
const noMetrics = (): Pick<FieldReadResult, 'metrics' | 'supportedMetrics' | 'droppedMetrics'> => ({
	metrics: {},
	supportedMetrics: [],
	droppedMetrics: [],
})

/** A read that settles either way: its answer, or `undefined` and `failed` for one that threw. */
const settled = <T>(work: Promise<T>): Promise<{ value?: T; failed: boolean }> =>
	work.then(
		(value) => ({ value, failed: false }),
		() => ({ failed: true })
	)

/** How a field read asks for one of the answers behind it. */
export type FieldReader = (
	adapter: AnalyticsAdapter,
	query: AnalyticsQuery,
	options: ReadOptions
) => Promise<AnalyticsResult>

/**
 * `read` asking the source in its own names and answering under the read's: `visits` from a source
 * that serves the count as `sessions`.
 */
const asAsked =
	(read: FieldReader): FieldReader =>
	(adapter, query, options) =>
		readAsAsked((served) => read(adapter, served, options), query, adapter.capabilities.metrics)

/** The reader a field read uses on one runtime. */
export type FieldReads = (runtime: AnalyticsRuntime) => FieldReader

/** Engine's own read with `options` laid over each read's own: a cached answer or the source's. */
export const engineReads =
	(options: ReadOptions = {}): FieldReads =>
	(runtime) =>
	(adapter, query, base) =>
		runtime.engine.read(adapter, query, { ...base, ...options })

/** A peek found nothing kept for one of the reads, so the field read has no answer to seed with. */
class PeekMissError extends Error {
	constructor() {
		super('analytics: nothing kept for this read yet')
		this.name = 'PeekMissError'
	}
}

/** What {@link peekForField} found. */
export interface FieldPeek {
	result: FieldReadResult
	/** False when a read behind it found nothing kept: the result is incomplete or failed for it. */
	complete: boolean
	/** True when an answer behind it was kept past its freshness and is served stale. */
	stale: boolean
}

/**
 * Field read answered only from what the engine keeps (memory and cache store, within `budgetMs`),
 * never a source; a status decided before any read is as final as {@link readForField}'s.
 */
export const peekForField = async (
	args: ReadForFieldArgs,
	budgetMs: number = PEEK_BUDGET_MS
): Promise<FieldPeek> => {
	let complete = true
	let stale = false
	const { incomplete: _unkept, ...result } = await readFieldWith(
		args,
		(runtime) => async (adapter, query) => {
			const kept = await runtime.engine.peek?.(adapter, query, { budgetMs })
			if (!kept) {
				complete = false
				throw new PeekMissError()
			}
			if (kept.meta.stale === true) {
				stale = true
			}
			return kept
		}
	)
	// What a peek left unread is `complete: false`, read again by the panel, not a failure.
	return { result, complete, stale }
}

/**
 * Reads a document's analytics for one display field, never throwing: a status picks the empty
 * state. An unsupported metric is dropped with a warning; `unavailable` only when none survives.
 */
export const readForField = (args: ReadForFieldArgs): Promise<FieldReadResult> =>
	readFieldWith(args, engineReads())

/**
 * A document scope with nothing this reader may read, a denied `access.read` or a tenant they do
 * not belong to is the reader's own reach, not an unavailable source.
 */
const refusedStatus = (
	reason: Extract<ReadContext, { ok: false }>['reason'],
	documentScoped: boolean
): FieldReadStatus => {
	if (
		reason === 'no-access' ||
		reason === 'not-member' ||
		(documentScoped && reason === 'no-sources')
	) {
		return 'no-access'
	}
	return reason === 'no-scope' ? 'no-scope' : 'unavailable'
}

/**
 * {@link readForField} with the reads behind it answered another way: the engine's own read with
 * other options, or {@link peekForField}'s look at what the engine has kept.
 */
export const readFieldWith = async (
	args: ReadForFieldArgs,
	via: FieldReads
): Promise<FieldReadResult> => {
	const { req, collectionSlug, data, timeframe, range, adapterId, now } = args
	const unreadRange = range ?? resolveTimeframe(timeframe, now)
	const unread = (
		status: FieldReadStatus,
		extra: Pick<FieldReadResult, 'untrustedScope'> = {}
	): FieldReadResult => ({
		status,
		...extra,
		adapterId: adapterId ?? '',
		dateRange: unreadRange,
		timezone: args.timezone ?? DEFAULT_TIMEZONE,
		...noMetrics(),
	})
	if (range && exceedsRangeCap(range)) {
		return unread('range-too-long')
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return unread('not-bound')
	}
	const read = asAsked(via(runtime))
	const binding = runtime.bindings[collectionSlug]
	if (!binding) {
		return unread('not-bound')
	}
	const documentScope = scopeFromDocument(data, binding.scopeField)
	let principal: ReadPrincipal = readPrincipalOf(args)
	// A pinned scope was already decided (a job's own, or one the caller cleared); anything
	// resolved from the document is a scope this reader is naming, gate and all.
	if (args.principal !== SYSTEM && args.scope === undefined) {
		const resolved = await resolveDocumentScope({ runtime, req, collection: collectionSlug, data })
		if (!resolved.ok) {
			return unread('no-access', { untrustedScope: true })
		}
		principal = resolved.scope === null ? {} : { scope: resolved.gated }
	}
	const ctx = await resolveReadContext({
		runtime,
		req,
		adapterId,
		...principal,
		// An item read goes through a source that can answer one, wherever the scope has one.
		...(args.report === 'item'
			? { prefer: (candidate: AnalyticsAdapter) => candidate.capabilities.perItemQuery === true }
			: {}),
	})
	if (!ctx.ok) {
		return unread(
			refusedStatus(ctx.reason, documentScope !== null),
			ctx.reason === 'not-member' ? { untrustedScope: true } : {}
		)
	}
	const tz = args.timezone ?? (await resolveTimezoneFor(runtime, req, ctx.scope))
	const resolved: ResolvedRead = {
		args,
		runtime,
		read,
		binding,
		adapter: ctx.adapter,
		scope: ctx.scope,
		queryScope: ctx.queryScope,
		tz,
		dateRange: range ?? resolveTimeframe(timeframe, now, tz),
		bindingCtx: { req, locale: req.locale ?? undefined },
	}
	return args.report === 'item' ? readItem(resolved) : readPage(resolved)
}

/** A field read past every gate: its source chosen, its scope and window resolved. */
interface ResolvedRead {
	args: ReadForFieldArgs
	runtime: AnalyticsRuntime
	read: FieldReader
	binding: ResolvedBinding
	adapter: AnalyticsAdapter
	scope: string | null
	queryScope: string | undefined
	tz: string
	dateRange: DateRange
	bindingCtx: BindingContext
}

/**
 * Splits the asked metrics by what the source serves; the dropped ones the caller did not add
 * speculatively are worth a warning.
 */
const splitMetrics = (args: ReadForFieldArgs, serves: (metric: MetricKey) => boolean) => {
	const supportedMetrics = args.metrics.filter(serves)
	const droppedMetrics = args.metrics.filter((metric) => !serves(metric))
	const optional = new Set(args.optionalMetrics ?? [])
	const unasked = droppedMetrics.filter((metric) => !optional.has(metric))
	return { supportedMetrics, droppedMetrics, unasked }
}

/** What every query of one read narrows by besides its page or item: host, zone, scope, goals. */
const sharedQuery = async (input: ResolvedRead, metrics: MetricKey[]) => {
	const hostname = await resolveHostname(input.binding, input.args.data, input.bindingCtx)
	const goalSlugs = await goalSlugsFor({
		runtime: input.runtime,
		req: input.args.req,
		scope: input.scope,
		metrics,
	})
	return {
		hostname,
		timezone: input.tz,
		scope: input.queryScope,
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
}

/** What a ranked list narrows to besides its own filter. */
interface ListScope {
	timezone: string
	hostname?: string | undefined
	scope?: string | undefined
}

/** How each list of a read is read: the same source, window and narrowing for all of them. */
interface ListReads {
	read: FieldReader
	adapter: AnalyticsAdapter
	within: ListScope
	dateRange: DateRange
	dimensions: DimensionKey[]
	limit: number
	options: ReadOptions
}

/** One dimension ranked by `metric` within `narrowing`; null when the read throws. */
const readRankedList = async (
	input: Omit<ListReads, 'dimensions'> & {
		dimension: DimensionKey
		metric: MetricKey
		narrowing: Pick<AnalyticsQuery, 'filters' | 'item'>
	}
): Promise<FieldBreakdown | null> => {
	const { dimension, metric, within, limit } = input
	try {
		const result = await input.read(
			input.adapter,
			{
				metrics: [metric],
				dimensions: [dimension],
				dateRange: input.dateRange,
				limit,
				order: { metric, direction: 'desc' },
				...input.narrowing,
				timezone: within.timezone,
				...(within.hostname === undefined ? {} : { hostname: within.hostname }),
				...(within.scope === undefined ? {} : { scope: within.scope }),
			},
			input.options
		)
		const rows = result.rows
			.map((row) => ({
				value: row.dimensions?.[dimension] ?? '',
				metric: row.metrics[metric] ?? 0,
			}))
			.slice(0, limit)
		return { dimension, metric, rows, ...readMeta(result) }
	} catch {
		return null
	}
}

/** Settles every list read: one that answered null is dropped alone and marks the set failed. */
const rankedLists = async (reads: Array<Promise<FieldBreakdown | null>>): Promise<RankedLists> => {
	const answered = await Promise.all(reads)
	const blocks = answered.filter((block): block is FieldBreakdown => block !== null)
	return { blocks, failed: blocks.length < answered.length }
}

/** Ranked by people rather than hits wherever the source counts them. */
const breakdownMetric = (adapter: AnalyticsAdapter): MetricKey =>
	adapter.capabilities.metrics.has('visitors') ? 'visitors' : 'pageviews'

/**
 * Ranks each dimension for one page via a `page eq` filter; a source that cannot filter or group
 * so gives no block rather than a site-wide list, and a block that throws is dropped alone.
 */
const readBreakdowns = async (lists: ListReads & { path: string }): Promise<RankedLists> => {
	const caps = lists.adapter.capabilities
	if (
		lists.dimensions.length === 0 ||
		!supportsFilter(caps, { dimension: 'page', operator: 'eq' })
	) {
		return NO_LISTS
	}
	const metric = breakdownMetric(lists.adapter)
	const wanted = lists.dimensions.filter(
		(dimension) =>
			caps.dimensions.has(dimension) &&
			metricReaches(caps, metric, { dimensions: [dimension], filters: ['page'] })
	)
	return rankedLists(
		wanted.map((dimension) =>
			readRankedList({
				...lists,
				dimension,
				metric,
				// `path` is deliberately not set: it selects the per-page report, which no source
				// groups a second dimension by. The filter is the same narrowing said another way.
				narrowing: { filters: [{ dimension: 'page', operator: 'eq', value: lists.path }] },
			})
		)
	)
}

/**
 * An `item eq` filter matches the item's views too, so clickers are its visitors with an
 * `item_click` event; a source unable to filter that ranks clicks instead. Null if neither.
 */
const clickList = (
	caps: AnalyticsAdapter['capabilities'],
	item: string
): { metric: MetricKey; filters: AnalyticsFilter[] } | null => {
	const byItem: AnalyticsFilter = { dimension: 'item', operator: 'eq', value: item }
	if (!supportsFilter(caps, byItem)) {
		return null
	}
	if (
		caps.metrics.has('visitors') &&
		supportsFilter(caps, { dimension: 'event', operator: 'eq' })
	) {
		return {
			metric: 'visitors',
			filters: [byItem, { dimension: 'event', operator: 'eq', value: ITEM_CLICK_EVENT }],
		}
	}
	return caps.metrics.has('interactions') ? { metric: 'interactions', filters: [byItem] } : null
}

/**
 * Ranks pages the item was seen on and where its clickers are (see {@link clickList}); a list the
 * source cannot rank is left out, and one that fails is dropped alone.
 */
const readItemBreakdowns = async (lists: ListReads & { item: string }): Promise<RankedLists> => {
	const caps = lists.adapter.capabilities
	const reads: Array<Promise<FieldBreakdown | null>> = []
	for (const dimension of lists.dimensions) {
		const pages = dimension === 'page'
		const clicks = pages ? null : clickList(caps, lists.item)
		if (!caps.dimensions.has(dimension) || (!pages && clicks === null)) {
			continue
		}
		const metric: MetricKey = clicks?.metric ?? 'impressions'
		if (!metricReaches(caps, metric, { dimensions: [dimension], filters: clicks?.filters ?? [] })) {
			continue
		}
		reads.push(
			readRankedList({
				...lists,
				dimension,
				metric,
				narrowing: clicks === null ? { item: lists.item } : { filters: clicks.filters },
			})
		)
	}
	return rankedLists(reads)
}

/** One read's queries, decided: what to read and through what, before any of it is asked. */
interface Answering {
	resolved: ResolvedRead
	/** Every query's narrowing to the document: its page or item, host, zone, scope and goals. */
	base: Omit<AnalyticsQuery, 'metrics' | 'dateRange'>
	supportedMetrics: MetricKey[]
	droppedMetrics: MetricKey[]
	/** The trend's metric and bucket; absent when no series is read. */
	series: { metric: MetricKey; granularity: SeriesGranularity } | undefined
	rank: () => Promise<RankedLists>
	report?: 'item'
	realtime?: boolean
}

/**
 * Reads the headline, then its comparison, series and lists beside it. Only the headline can fail
 * the read; any other that fails leaves the answer `incomplete`.
 */
const readAnswers = async (answering: Answering): Promise<FieldReadResult> => {
	const { resolved, base, supportedMetrics, droppedMetrics, series } = answering
	const { read, adapter, dateRange, tz } = resolved
	const comparisonRange = resolved.args.compare
		? comparisonWindow(resolved, resolved.args.now)
		: undefined
	const options: ReadOptions = { timeframe: resolved.args.timeframe }
	const reportTag = answering.report === undefined ? {} : { report: answering.report }
	// The headline takes the source's first slot and alone can fail the read; the lists wait for it.
	const main = read(adapter, { ...base, metrics: supportedMetrics, dateRange }, options)
	const comparing = comparisonRange
		? settled(
				read(adapter, { ...base, metrics: supportedMetrics, dateRange: comparisonRange }, options)
			)
		: undefined
	const charting = series
		? settled(
				read(
					adapter,
					{ ...base, metrics: [series.metric], dateRange, granularity: series.granularity },
					options
				)
			)
		: undefined
	const ranking = main.then(
		() => answering.rank(),
		() => NO_LISTS
	)
	let result: AnalyticsResult
	try {
		result = await main
	} catch (err) {
		// Nothing cached survived the failed read: a status, never a throw through the edit view.
		return {
			...readFailureOf(err),
			...reportTag,
			adapterId: adapter.id,
			dateRange,
			timezone: tz,
			metrics: {},
			supportedMetrics,
			droppedMetrics,
		}
	}
	const [compared, charted, lists] = await Promise.all([comparing, charting, ranking])
	const previous = compared?.value
	const seriesResult = charted?.value
	const ranked = lists.blocks
	const incomplete = compared?.failed === true || charted?.failed === true || lists.failed
	return {
		status: 'ok',
		...(incomplete ? { incomplete: true as const } : {}),
		...reportTag,
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		...(answering.realtime === undefined ? {} : { realtime: answering.realtime }),
		...(ranked.length > 0 ? { breakdowns: ranked } : {}),
		notices: mergeNotices(readMeta(result), seriesResult ? readMeta(seriesResult) : undefined),
		metrics: result.totals ?? {},
		supportedMetrics,
		droppedMetrics,
		previousMetrics: previous ? (previous.totals ?? {}) : undefined,
		comparisonRange: previous ? comparisonRange : undefined,
		points:
			seriesResult && series
				? fillSeries({
						rows: seriesResult.rows,
						dateRange,
						metric: series.metric,
						tz,
						granularity: series.granularity,
					})
				: undefined,
		seriesGranularity: seriesResult ? series?.granularity : undefined,
	}
}

/** Document read as its own page, at the path its binding resolves. */
const readPage = async (resolved: ResolvedRead): Promise<FieldReadResult> => {
	const { args, binding, adapter, tz, dateRange } = resolved
	const unread = (status: FieldReadStatus): FieldReadResult => ({
		status,
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		...noMetrics(),
	})
	let path: string | null
	try {
		path = await resolvePathCached(binding, args.data, resolved.bindingCtx)
	} catch {
		path = null
	}
	if (!path) {
		return unread('no-path')
	}
	if (!adapter.isConfigured()) {
		return unread('not-configured')
	}
	const caps = adapter.capabilities
	const servesForPage = (metric: MetricKey): boolean => {
		const name = servedName(metric, caps.metrics)
		return caps.metrics.has(name) && metricReaches(caps, name, { path: true })
	}
	const { supportedMetrics, droppedMetrics, unasked } = splitMetrics(args, servesForPage)
	if (unasked.length > 0) {
		args.req.payload.logger.warn(
			`analytics: adapter "${adapter.id}" does not support metric(s) ${unasked.join(', ')}; dropped from the "${args.collectionSlug}" display field`
		)
	}
	const leadMetric = supportedMetrics[0]
	if (
		leadMetric === undefined ||
		!satisfiesCapabilities(caps, {
			metrics: supportedMetrics.map((metric) => servedName(metric, caps.metrics)),
			path: true,
		})
	) {
		return { ...unread('unavailable'), droppedMetrics: args.metrics }
	}
	const shared = await sharedQuery(resolved, supportedMetrics)
	return readAnswers({
		resolved,
		base: { path, ...shared },
		supportedMetrics,
		droppedMetrics,
		series:
			args.series && supportsGranularity(caps, 'day')
				? { metric: leadMetric, granularity: seriesGranularityFor(dateRange, caps) }
				: undefined,
		rank: () =>
			readBreakdowns({
				read: resolved.read,
				adapter,
				path,
				within: shared,
				dateRange,
				dimensions: args.dimensions ?? [],
				limit: args.limit ?? DEFAULT_BREAKDOWN_LIMIT,
				options: { timeframe: args.timeframe },
			}),
		realtime: caps.realtime && typeof adapter.realtime === 'function',
	})
}

/**
 * Document read as a content item under its ref `<collection>:<id>`. Metrics an item's buckets
 * never count are dropped like unserved ones; nothing about an item is counted live.
 */
const readItem = async (resolved: ResolvedRead): Promise<FieldReadResult> => {
	const { args, binding, adapter, tz, dateRange } = resolved
	const unread = (status: FieldReadStatus): FieldReadResult => ({
		status,
		report: 'item',
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		...noMetrics(),
	})
	if (!bindsItems(binding)) {
		return unread('not-bound')
	}
	const ref = itemRefOf(args.collectionSlug, args.data.id)
	if (ref === undefined) {
		return unread('no-path')
	}
	if (!adapter.isConfigured()) {
		return unread('not-configured')
	}
	const caps = adapter.capabilities
	const { supportedMetrics, droppedMetrics, unasked } = splitMetrics(
		args,
		(metric) => caps.metrics.has(metric) && ITEM_READ_METRICS.has(metric)
	)
	if (unasked.length > 0 && caps.perItemQuery === true) {
		args.req.payload.logger.warn(
			`analytics: adapter "${adapter.id}" cannot read metric(s) ${unasked.join(', ')} for an item; dropped from the "${args.collectionSlug}" display field`
		)
	}
	const first = supportedMetrics[0]
	if (caps.perItemQuery !== true || first === undefined) {
		return { ...unread('unavailable'), droppedMetrics: args.metrics }
	}
	const shared = await sharedQuery(resolved, supportedMetrics)
	// Never by hour: an item's views are only kept per day, so a short window reads its days.
	const bucket = seriesGranularityFor(dateRange, caps)
	return readAnswers({
		resolved,
		base: { item: ref, ...shared },
		supportedMetrics,
		droppedMetrics,
		series:
			args.series && supportsGranularity(caps, 'day')
				? { metric: first, granularity: bucket === 'hour' ? 'day' : bucket }
				: undefined,
		rank: () =>
			readItemBreakdowns({
				read: resolved.read,
				adapter,
				item: ref,
				within: shared,
				dateRange,
				dimensions: args.dimensions ?? [],
				limit: args.limit ?? DEFAULT_BREAKDOWN_LIMIT,
				options: { timeframe: args.timeframe },
			}),
		report: 'item',
	})
}
