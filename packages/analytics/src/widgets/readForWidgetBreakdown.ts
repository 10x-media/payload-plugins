import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import { metricReaches } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsFilter,
	AnalyticsResult,
	DateRange,
	DimensionKey,
	MetricKey,
	MetricValue,
	MetricValues,
} from '../core/contract'
import { emptyReading } from '../core/metricValues'
import { hasNoDeclaredGoals, isLatentGoalRow } from '../goals/latent'
import { resolveItemLabels } from '../plugin/itemLabels'
import { readFailureOf } from '../surfacing/classifyError'
import type { TimeframePreset } from '../timeframe/presets'
import { intlLocale } from '../translations/intl'
import { asTranslate } from '../translations/server'
import { valueLabel } from '../view/labels'
import {
	engineRead,
	pinnedScope,
	prepareWidgetRead,
	type StoredSourceRead,
	type SubstitutedSource,
	substitutionOf,
	type WidgetReadStatus,
} from './prepareWidgetRead'
import { type ReadNotices, readMeta } from './readMeta'

export interface BreakdownRow {
	/**
	 * What the reader sees, in the admin language as every built-in surface labels the row:
	 * a goal's name, a country's, an item's title, `Not set` for a row with no value.
	 */
	label: string
	/** The stored value, `''` for a row with no value: what a filter or a link to the view keeps. */
	dimensionValue: string
	/** `null` when the row has no reading for an average, which is no data rather than zero. */
	value: MetricValue
	/** Every metric the read asked for, present only when `extraMetrics` asked for more. */
	metrics?: MetricValues
}

export interface WidgetBreakdownResult extends Partial<ReadNotices>, SubstitutedSource {
	status: WidgetReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	adapterId: string
	/** The reporting timezone the read resolved in, which names its days. */
	timezone?: string
	/**
	 * Scope a link to this read must name, set only when the viewer would not resolve it alone:
	 * a needless `scope` refuses every reader without `access.crossScope`.
	 */
	scope?: string
	dateRange: DateRange
	rows: BreakdownRow[]
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	/** True when the read asked about goals and the scope declared none: an empty table. */
	noGoals?: boolean
	/** The scope's goals behind a `goal` read's slugs, so its rows read as names. */
	goals?: Array<{ slug: string; name: string }>
}

/** Scoped like `ReadForWidgetArgs`: the request's own scope unless one is pinned. */
export type ReadForWidgetBreakdownArgs = ReadPrincipal &
	StoredSourceRead & {
		req: PayloadRequest
		metric: MetricKey
		dimension: DimensionKey
		timeframe: TimeframePreset
		limit: number
		adapterId?: string
		now: Date
		range?: DateRange
		/**
		 * Reporting timezone the caller already resolved, reused rather than resolved again so
		 * a caller-supplied `range` is read in the very timezone it was interpreted in.
		 */
		timezone?: string
		filters?: AnalyticsFilter[]
		/**
		 * Further metrics read beside the ranked one, narrowed to what the source serves so an
		 * unsupported one never fails the read. Ranking and status follow `metric` alone.
		 */
		extraMetrics?: MetricKey[]
		/**
		 * Scope's goal slugs for a `goal` or `conversions` read, or `'unresolved'` if the caller's
		 * resolver failed. Resolved here when omitted.
		 */
		goalSlugs?: string[] | 'unresolved'
		/** The latent built-in slugs behind that hint; resolved here when omitted. */
		builtinGoalSlugs?: string[]
	}

/**
 * Ranked breakdown of one metric by one dimension: `readForWidget` gated on the dimension too,
 * each row labelled as built-in widgets label it. The adapter owns sorting and limiting.
 */
export const readForWidgetBreakdown = async (
	args: ReadForWidgetBreakdownArgs
): Promise<WidgetBreakdownResult> => {
	const { req, metric, dimension, timeframe, limit, adapterId, now, range, filters } = args
	const metricsFor = (adapter: AnalyticsAdapter): MetricKey[] => [
		metric,
		...(args.extraMetrics ?? []).filter(
			(m) =>
				m !== metric &&
				adapter.capabilities.metrics.has(m) &&
				metricReaches(adapter.capabilities, m, { dimensions: [dimension] })
		),
	]
	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		...readPrincipalOf(args),
		...(args.fallbackWhenUnreadable ? { fallbackWhenUnreadable: true } : {}),
		timezone: args.timezone,
		range,
		filters,
		requires: { metrics: [metric], dimensions: [dimension] },
		goalRead: (adapter) => ({ metrics: metricsFor(adapter), dimensions: [dimension] }),
		goalSlugs: args.goalSlugs,
		...(args.builtinGoalSlugs === undefined ? {} : { builtinGoalSlugs: args.builtinGoalSlugs }),
	})
	if (!prepared.ok) {
		return {
			status: prepared.status,
			adapterId: prepared.adapterId,
			dateRange: prepared.dateRange,
			rows: [],
		}
	}
	const { adapter, tz, dateRange, goalSlugs, builtinGoalSlugs, goalNames } = prepared
	const metrics = metricsFor(adapter)
	const read = engineRead(prepared, timeframe)
	let result: AnalyticsResult
	try {
		result = await read({
			metrics,
			dimensions: [dimension],
			dateRange,
			limit,
			order: { metric, direction: 'desc' },
			filters,
			timezone: tz,
			scope: prepared.queryScope,
			...(goalSlugs === undefined ? {} : { goalSlugs }),
		})
	} catch (err) {
		// A failed read is a status, never a throw through the render tree.
		return { ...readFailureOf(err), adapterId: adapter.id, dateRange, rows: [] }
	}
	const kept = result.rows
		.map((row) => ({
			dimensionValue: row.dimensions?.[dimension] ?? '',
			value: row.metrics[metric] ?? emptyReading(metric),
			...(metrics.length > 1 ? { metrics: row.metrics } : {}),
		}))
		// A built-in goal is latent: it earns a row once someone has converted on it, and until
		// then a site that sells nothing would read a "Purchase" row at zero in every report.
		.filter(
			(row) =>
				dimension !== 'goal' ||
				!isLatentGoalRow(
					row.dimensionValue,
					metric === 'conversions' ? row.value : row.metrics?.conversions,
					builtinGoalSlugs
				)
		)
	const itemLabels =
		dimension === 'item'
			? await resolveItemLabels(
					req,
					kept.map((row) => row.dimensionValue)
				).catch((): undefined => undefined)
			: undefined
	// A request built without Payload's i18n (a bare Local API caller) has no words to label with.
	const translate = req.i18n?.t
	const locale = intlLocale(req.i18n?.language)
	const rows: BreakdownRow[] = kept.map((row) => ({
		label:
			translate === undefined
				? row.dimensionValue
				: valueLabel({
						dimension,
						value: row.dimensionValue,
						provider: result.meta.provider,
						t: asTranslate(translate),
						locale,
						goals: goalNames,
						...(itemLabels ? { itemLabels } : {}),
					}),
		...row,
	}))
	return {
		status: 'ok',
		adapterId: adapter.id,
		...substitutionOf(prepared),
		...pinnedScope(args, prepared.queryScope),
		dateRange,
		timezone: tz,
		rows,
		...readMeta(result),
		// The hint is set only for a read about goals, so one carrying nothing the install
		// declared is a scope that configured none rather than a read that never asked.
		noGoals: Array.isArray(goalSlugs) && hasNoDeclaredGoals(goalSlugs, builtinGoalSlugs),
		...(dimension === 'goal' && goalNames.length > 0 ? { goals: goalNames } : {}),
	}
}
