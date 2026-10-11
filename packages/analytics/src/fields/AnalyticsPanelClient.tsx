'use client'

import { Banner, Button, useConfig, useDocumentInfo } from '@payloadcms/ui'
import { type ReactNode, useState } from 'react'
import type { ReportMode } from '../binding/report'
import type { SeriesGranularity, SeriesPoint } from '../charts/series'
import type { DimensionKey, MetricKey, MetricValues } from '../core/contract'
import { isRecord } from '../core/values'
import { apiPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { intlLocale } from '../translations/intl'
import { keys, type TranslationKey } from '../translations/keys'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import { useTranslation } from '../translations/useTranslation'
import { LabeledSelect } from '../ui/components/LabeledSelect'
import { type RequestFailure, requestShaped } from '../ui/data/request'
import { useRequest } from '../ui/data/useRequest'
import { retryOfferFor } from '../ui/readState'
import { viewerNow } from '../ui/viewerClock'
import type { CountryFlags } from '../view/CountryFlag'
import type { ReadNotices } from '../widgets/readMeta'
import { AnalyticsEmptyState, isNewDocumentAnalytics } from './emptyState'
import { ITEM_PANEL_DIMENSIONS } from './itemReport'
import { PanelContent } from './PanelContent'
import { PanelLiveCounter } from './PanelLiveCounter'
import { PanelSkeleton } from './PanelSkeleton'
import type { FieldBreakdown, FieldReadStatus } from './readForDocument'
import { FIELD_STATE_KEYS } from './stateKeys'
import '../ui/analytics.css'

/** JSON-safe shape of a document analytics read, as the panel endpoint returns it. */
export interface PanelData {
	status: FieldReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	/** The headline answered, but a comparison, series or list did not. */
	incomplete?: true
	/** `item` for a read about the document as a content item; absent for its own page. */
	report?: 'item'
	/** An average with nothing to average over is `null`, which the cards show as a dash. */
	metrics: MetricValues
	supportedMetrics: MetricKey[]
	previousMetrics?: MetricValues
	comparisonRange?: { start: string; end: string } | null
	/** Reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone?: string
	/** The window the read covered, which decides whether a document with no data is new. */
	dateRange?: { start: string; end: string }
	points?: SeriesPoint[]
	/** The bucket `points` carry; a chart drawn by hour needs hourly rows to draw. */
	seriesGranularity?: SeriesGranularity
	/** The source counts live visitors, so the live counter is worth polling for. */
	realtime?: boolean
	/** One ranked list per dimension the source could narrow to this page. */
	breakdowns?: FieldBreakdown[]
	/** What the totals' and the series' reads say about their numbers. */
	notices?: ReadNotices
}

/** The parts of a panel answer the panel reads before it renders. */
const isPanelData = (value: unknown): value is PanelData =>
	isRecord(value) &&
	typeof value.status === 'string' &&
	isRecord(value.metrics) &&
	Array.isArray(value.supportedMetrics) &&
	(value.points === undefined || Array.isArray(value.points)) &&
	(value.breakdowns === undefined || Array.isArray(value.breakdowns))

/**
 * How far server's seed can be trusted: `fresh` needs no read, `stale` shows and is reread from
 * its source, `missing` has nothing worth showing and is read before cards appear.
 */
export type PanelSeed = 'fresh' | 'stale' | 'missing'

/** One source the switcher may offer, and whether it can read a document as an item. */
export interface PanelSource {
	id: string
	label: string
	perItemQuery?: boolean
}

export interface AnalyticsPanelClientProps {
	collectionSlug: string
	metrics: MetricKey[]
	/** Metrics the factory added speculatively, echoed so a refetch keeps them unwarned. */
	optionalMetrics?: MetricKey[]
	/** Dimensions to rank for this page; empty leaves the breakdown row out. */
	dimensions: DimensionKey[]
	/** Poll the live counter where the source counts live visitors. */
	liveVisitors: boolean
	/** The flag beside a country name: none, the plugin's own, or the host's component. */
	countryFlags: CountryFlags
	/** The server's seed; absent when it had none, and the panel reads before showing numbers. */
	initial?: PanelData
	/**
	 * The instant the server rendered the panel, which the seed's counting bucket is marked by: one
	 * clock for the server's markup and the browser's first paint, so the two never disagree.
	 */
	renderedAt: string
	/** How far to trust `initial`; absent means `fresh` with a seed and `missing` without one. */
	seed?: PanelSeed
	initialTimeframe: TimeframePreset
	adapterId?: string
	/**
	 * Sources this document's scope offers, prefiltered to what reader may read and can narrow to
	 * that scope. One entry draws no switcher; item report offers only those that read an item.
	 */
	sources?: PanelSource[]
	/** The source the server read through, which the switcher opens on. */
	initialSourceId?: string
	/** Metric card labels resolved to plain strings on the server. */
	labels?: Partial<Record<MetricKey, string>>
	/** ISO 4217 code revenue renders in; absent leaves it a plain number. */
	currency?: string
	/** The reports the panel offers, the one it opened on first. More than one draws a switch. */
	modes?: ReportMode[]
	/** The report the server read for the first paint. */
	initialReport?: ReportMode
	/** Item card labels the developer set; other cards keep the item report's own names. */
	itemLabelOverrides?: Partial<Record<MetricKey, string>>
	/** Creation time (ISO), absent without timestamps; see {@link isNewDocumentAnalytics}. */
	createdAt?: string
}

const REPORT_LABELS: Record<ReportMode, TranslationKey> = {
	item: keys.panelReportItem,
	page: keys.panelReportPage,
}

/** The window and the read that answered for it, which only ever change together. */
interface PanelView {
	timeframe: TimeframePreset
	data: PanelData
	/** When the numbers were read, which decides the bucket that is still counting. */
	readAt: string
}

/** Stands in for the numbers while the first read runs; nothing renders from it. */
const NOTHING_YET: PanelData = { status: 'ok', metrics: {}, supportedMetrics: [] }

interface PanelRead {
	preset: TimeframePreset
	source: string | undefined
	mode: ReportMode
}

const readKey = (read: PanelRead): string => JSON.stringify(read)

/** What the panel says for a request that failed, worded as a read's status would be. */
const failedState = (
	failure: RequestFailure | undefined
): Pick<PanelData, 'status' | 'retryAfterMs'> => {
	switch (failure?.code) {
		case 'forbidden':
			return { status: 'no-access' }
		case 'range_too_long':
			return { status: 'range-too-long' }
		case 'invalid_param':
			return { status: 'invalid' }
		case 'unsupported':
		case 'not_found':
			return { status: 'unavailable' }
		case 'source_misconfigured':
			return { status: failure.hostRefused ? 'host-refused' : 'misconfigured' }
		case 'unavailable':
		case 'rate_limited':
			return {
				status: 'busy',
				...(failure.retryAfter === undefined ? {} : { retryAfterMs: failure.retryAfter * 1000 }),
			}
		default:
			return { status: 'busy' }
	}
}

/** Statuses that are a failure of the read, said in an error banner, rather than a state. */
const FAILED: ReadonlySet<FieldReadStatus> = new Set<FieldReadStatus>([
	'busy',
	'invalid',
	'range-too-long',
	'misconfigured',
	'host-refused',
])

/** Cards an item report draws for most sources: views, viewers, clicks and the click rate. */
const ITEM_SKELETON_CARDS = 4

/** The lists a report ranks: the item's own wherever the panel draws lists at all. */
const listsFor = (report: ReportMode, dimensions: DimensionKey[]): DimensionKey[] =>
	report === 'item' && dimensions.length > 0 ? ITEM_PANEL_DIMENSIONS : dimensions

/** The source a report reads through: the current one where it can, else the first that can. */
const sourceFor = (
	report: ReportMode,
	current: string | undefined,
	sources: PanelSource[]
): string | undefined => {
	if (report === 'page' || sources.length === 0) {
		return current
	}
	if (sources.some((source) => source.id === current && source.perItemQuery === true)) {
		return current
	}
	return sources.find((source) => source.perItemQuery === true)?.id ?? current
}

/**
 * Per-document analytics panel. A stale or missing server seed is reread on mount (when its tab
 * opens); on a collection bound as items it reports the document as content shown elsewhere.
 */
export function AnalyticsPanelClient(props: AnalyticsPanelClientProps) {
	const {
		collectionSlug,
		metrics,
		optionalMetrics,
		dimensions,
		liveVisitors,
		countryFlags,
		initial,
		initialTimeframe,
		adapterId,
	} = props
	const modes: ReportMode[] = props.modes ?? ['page']
	const sources = props.sources ?? []
	const { t, i18n } = useTranslation()
	const locale = intlLocale(i18n.language)
	const { id } = useDocumentInfo()
	const { config } = useConfig()
	const documentEndpoint = apiPath(config, analyticsRoutes(config).document)
	const seed: PanelSeed = props.seed ?? (initial ? 'fresh' : 'missing')
	const initialSourceId = props.initialSourceId ?? adapterId
	const initialReport = props.initialReport ?? modes[0] ?? 'page'
	// `pending` is what the picker shows; the caption and every formatter follow the window the
	// numbers on screen were read for, which only changes when that read lands.
	const [pending, setPending] = useState<TimeframePreset>(initialTimeframe)
	const [sourceId, setSourceId] = useState<string | undefined>(initialSourceId)
	const [report, setReport] = useState<ReportMode>(initialReport)

	const read: PanelRead = { preset: pending, source: sourceId, mode: report }
	const documentId = id === undefined || id === null ? null : String(id)
	// Mounting means the tab is open, so an unvouched seed is read now, never in the document's
	// render. Another source or report restarts from the shimmer; another window dims old numbers.
	const request = useRequest<PanelView>({
		key: documentId === null ? null : readKey(read),
		keep: `${sourceId ?? ''}|${report}`,
		...(initial === undefined || seed === 'missing'
			? {}
			: {
					seed: {
						key: readKey({
							preset: initialTimeframe,
							source: initialSourceId,
							mode: initialReport,
						}),
						data: { timeframe: initialTimeframe, data: initial, readAt: props.renderedAt },
						stale: seed === 'stale',
					},
				}),
		run: async ({ signal, revalidating }) => {
			const params = new URLSearchParams({
				collection: collectionSlug,
				id: documentId ?? '',
				timeframe: read.preset,
				compare: '1',
				series: '1',
				report: read.mode,
			})
			// An item report reads the item's own metrics and lists, which the endpoint knows.
			if (read.mode === 'page') {
				params.set('metrics', metrics.join(','))
				const optional = optionalMetrics?.join(',') ?? ''
				if (optional !== '') {
					params.set('optional', optional)
				}
			}
			const lists = listsFor(read.mode, dimensions).join(',')
			if (lists !== '') {
				params.set('dimensions', lists)
			}
			if (read.source) {
				params.set('dataSource', read.source)
			}
			// A stale seed is read past its expired cache entry, straight from its source.
			if (revalidating) {
				params.set('fresh', '1')
			}
			const data = await requestShaped(`${documentEndpoint}?${params}`, isPanelData, { signal })
			return { timeframe: read.preset, data, readAt: viewerNow().toISOString() }
		},
	})
	const retriable = documentId !== null && request.status === 'error'

	const onTimeframeChange = (preset: TimeframePreset) => {
		// Re-picking the window already selected is a retry after a failed read, the one way back
		// from the unavailable state without touching the picker twice.
		if (preset === pending) {
			request.refetch()
			return
		}
		setPending(preset)
	}

	const onReportChange = (next: ReportMode) => {
		setReport(next)
		setSourceId(sourceFor(next, sourceId, sources))
	}

	const shownView = (): Omit<PanelView, 'data'> & { data: PanelData | undefined } => {
		// Nothing to read for a document that has no id: the seed stands, or the panel says so.
		if (documentId === null) {
			return {
				timeframe: initialTimeframe,
				data: initial ?? { ...NOTHING_YET, status: 'unavailable' },
				readAt: props.renderedAt,
			}
		}
		const timeframe = request.data?.timeframe ?? pending
		const readAt = request.data?.readAt ?? props.renderedAt
		if (!retriable) {
			return { timeframe, data: request.data?.data, readAt }
		}
		return {
			timeframe,
			data: {
				...(request.data?.data ?? NOTHING_YET),
				...failedState(request.error),
				...(report === 'item' ? { report: 'item' } : {}),
			},
			readAt,
		}
	}
	const view = shownView()
	const loading = request.isRefetching
	const waiting = view.data === undefined
	const data = view.data ?? NOTHING_YET
	const itemData = data.report === 'item'
	const offered = sources.filter((source) => report === 'page' || source.perItemQuery === true)
	const retryButton =
		documentId === null ? null : (
			<Button buttonStyle="secondary" margin={false} onClick={() => request.refetch()} size="small">
				{t(keys.viewRetry)}
			</Button>
		)

	const body = (): ReactNode => {
		if (waiting) {
			return (
				<PanelSkeleton
					cards={report === 'item' ? ITEM_SKELETON_CARDS : metrics.length}
					lists={listsFor(report, dimensions).length}
				/>
			)
		}
		if (isNewDocumentAnalytics(data, props.createdAt)) {
			return (
				<div className="analytics-panel__empty">
					<AnalyticsEmptyState isNew>{t(keys.stateNew)}</AnalyticsEmptyState>
					<span>{t(itemData ? keys.panelNewItem : keys.panelNewPage)}</span>
				</div>
			)
		}
		if (data.status !== 'ok' && FAILED.has(data.status)) {
			const retry = retryOfferFor(data.status, data.retryAfterMs, { t, locale })
			return (
				<div className="analytics-panel__state">
					<Banner type="error">{t(FIELD_STATE_KEYS[data.status])}</Banner>
					{retry?.after ? <span className="analytics-panel__caption">{retry.after}</span> : null}
					{retry ? retryButton : null}
				</div>
			)
		}
		if (data.status !== 'ok') {
			return (
				<AnalyticsEmptyState isNew={false}>{t(FIELD_STATE_KEYS[data.status])}</AnalyticsEmptyState>
			)
		}
		return (
			<PanelContent
				countryFlags={countryFlags}
				currency={props.currency}
				data={data}
				itemLabelOverrides={props.itemLabelOverrides}
				labels={props.labels}
				readAt={view.readAt}
				retryButton={retryButton}
				timeframe={view.timeframe}
			/>
		)
	}

	// The toolbar is the analytics view's in miniature: the controls on the left in the view's
	// order, the live indicator pushed right, and everything free to wrap on a narrow sidebar.
	return (
		<div className="field-type analytics-panel">
			<div className="analytics-panel__toolbar">
				<div className="analytics-panel__controls">
					{modes.length > 1 ? (
						<div className="analytics-panel__control">
							<LabeledSelect
								label={t(keys.panelReportLabel)}
								onChange={(next) => {
									if (next !== report) {
										onReportChange(next)
									}
								}}
								options={modes.map((mode) => ({ value: mode, label: t(REPORT_LABELS[mode]) }))}
								value={report}
							/>
						</div>
					) : null}
					{offered.length > 1 ? (
						<div className="analytics-panel__control">
							<LabeledSelect
								label={t(keys.viewSourceLabel)}
								onChange={(next) => {
									if (next !== sourceId) {
										setSourceId(next)
									}
								}}
								options={offered.map((s) => ({ value: s.id, label: s.label }))}
								value={sourceId}
							/>
						</div>
					) : null}
					<div className="analytics-panel__control">
						<LabeledSelect
							label={t(keys.widgetFieldRange)}
							onChange={(preset) => {
								if (preset !== pending || retriable) {
									onTimeframeChange(preset)
								}
							}}
							options={TIMEFRAME_PRESETS.map((preset) => ({
								value: preset,
								label: t(TIMEFRAME_KEYS[preset]),
							}))}
							value={pending}
						/>
					</div>
				</div>
				{liveVisitors && !itemData && data.realtime && documentId !== null ? (
					<PanelLiveCounter
						collectionSlug={collectionSlug}
						{...(sourceId ? { dataSource: sourceId } : {})}
						documentId={documentId}
					/>
				) : null}
			</div>
			<div
				aria-busy={loading || waiting}
				className={
					loading && !waiting
						? 'analytics-panel__body analytics-panel__body--dimmed'
						: 'analytics-panel__body'
				}
			>
				{body()}
			</div>
		</div>
	)
}
