import type { PayloadRequest, TaskConfig, WidgetInstance } from 'payload'
import type { DateRange, DimensionKey, MetricKey } from '../core/contract'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { breakdownSpecBySlug } from '../widgets/breakdownTypes'
import { resolveCustomRange } from '../widgets/range'
import { readForWidget } from '../widgets/readForWidget'
import { readForWidgetBreakdown } from '../widgets/readForWidgetBreakdown'
import { readForWidgetSeries } from '../widgets/readForWidgetSeries'
import { WIDGET_METRICS, type WidgetRange } from '../widgets/types'

/** Minimal shape of a dashboard widget instance the warm job reads. */
export interface WarmWidgetInstance {
	widgetSlug?: string
	data?: Record<string, unknown>
}

export type WarmTarget =
	| {
			kind: 'metric'
			metric: MetricKey
			timeframe: TimeframePreset
			range?: DateRange
			adapterId?: string
	  }
	| {
			kind: 'series'
			metric: MetricKey
			timeframe: TimeframePreset
			range?: DateRange
			adapterId?: string
	  }
	| {
			kind: 'breakdown'
			metric: MetricKey
			dimension: DimensionKey
			timeframe: TimeframePreset
			limit: number
			range?: DateRange
			adapterId?: string
	  }

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const asMetric = (v: unknown): MetricKey =>
	typeof v === 'string' && (WIDGET_METRICS as readonly string[]).includes(v)
		? (v as MetricKey)
		: 'pageviews'

const asTimeframe = (v: unknown): TimeframePreset | 'custom' => {
	if (v === 'custom') {
		return 'custom'
	}
	if (typeof v === 'string' && (TIMEFRAME_PRESETS as readonly string[]).includes(v)) {
		return v as TimeframePreset
	}
	return 'last30days'
}

const asLimit = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 5)

const asRange = (v: unknown): WidgetRange | undefined => {
	if (!v || typeof v !== 'object') {
		return undefined
	}
	const r = v as { from?: unknown; to?: unknown }
	return { from: asString(r.from), to: asString(r.to) }
}

const targetKey = (t: WarmTarget): string => {
	const range = t.range ? `${t.range.start.toISOString()}:${t.range.end.toISOString()}` : ''
	const dimension = t.kind === 'breakdown' ? t.dimension : ''
	const limit = t.kind === 'breakdown' ? String(t.limit) : ''
	return `${t.kind}:${t.metric}:${dimension}:${t.timeframe}:${limit}:${t.adapterId ?? ''}:${range}`
}

/**
 * Map a dashboard's widget layout to the set of reads that warm its cache. Built-in
 * metric, trend, and breakdown widgets become targets; the realtime widget is skipped
 * (its short-TTL key is kept warm by the live poller) and any other slug is a custom app
 * widget whose read shape the plugin does not know. A `custom` timeframe is kept only when
 * its range resolves (the read takes an explicit range; `timeframe` is then unused).
 * Identical targets are de-duplicated so a repeated widget warms its tuple once.
 */
export const deriveWarmTargets = (widgets: readonly WarmWidgetInstance[]): WarmTarget[] => {
	const out: WarmTarget[] = []
	const seen = new Set<string>()
	for (const widget of widgets) {
		const slug = widget.widgetSlug
		if (!slug || slug === 'analytics-realtime') {
			continue
		}
		const data = widget.data ?? {}
		const metric = asMetric(data.metric)
		const adapterId = asString(data.dataSource)
		const timeframeRaw = asTimeframe(data.timeframe)
		let timeframe: TimeframePreset = 'last30days'
		let range: DateRange | undefined
		if (timeframeRaw === 'custom') {
			const resolved = resolveCustomRange('custom', asRange(data.range))
			if (!resolved) {
				continue
			}
			range = resolved
		} else {
			timeframe = timeframeRaw
		}

		let target: WarmTarget | undefined
		if (slug === 'analytics-metric') {
			target = { kind: 'metric', metric, timeframe, range, adapterId }
		} else if (slug === 'analytics-trend') {
			target = { kind: 'series', metric, timeframe, range, adapterId }
		} else {
			const spec = breakdownSpecBySlug(slug)
			if (spec) {
				target = {
					kind: 'breakdown',
					metric,
					dimension: spec.dimension,
					timeframe,
					limit: asLimit(data.limit),
					range,
					adapterId,
				}
			}
		}
		if (!target) {
			continue
		}
		const key = targetKey(target)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		out.push(target)
	}
	return out
}

export const WARM_TASK_SLUG = 'analytics-warm-cache'

/** A dashboard `defaultLayout`: an array, or a function resolving one per request. */
export type WarmLayout =
	| ((args: { req: PayloadRequest }) => WidgetInstance[] | Promise<WidgetInstance[]>)
	| WidgetInstance[]
	| undefined

const resolveLayout = async (
	layout: WarmLayout,
	req: PayloadRequest
): Promise<WarmWidgetInstance[]> => {
	try {
		const list = typeof layout === 'function' ? await layout({ req }) : (layout ?? [])
		return list.map((w) => ({ widgetSlug: w.widgetSlug, data: w.data }))
	} catch (err) {
		req.payload.logger.warn(
			`analytics warm-cache: could not resolve the dashboard layout: ${String(err)}`
		)
		return []
	}
}

/** Run one target's read; returns true when the read served data (status `ok`). */
const runTarget = async (target: WarmTarget, req: PayloadRequest, now: Date): Promise<boolean> => {
	if (target.kind === 'metric') {
		const result = await readForWidget({
			req,
			metrics: [target.metric],
			timeframe: target.timeframe,
			adapterId: target.adapterId,
			now,
			range: target.range,
		})
		return result.status === 'ok'
	}
	if (target.kind === 'series') {
		const result = await readForWidgetSeries({
			req,
			metric: target.metric,
			timeframe: target.timeframe,
			adapterId: target.adapterId,
			now,
			range: target.range,
		})
		return result.status === 'ok'
	}
	const result = await readForWidgetBreakdown({
		req,
		metric: target.metric,
		dimension: target.dimension,
		timeframe: target.timeframe,
		limit: target.limit,
		adapterId: target.adapterId,
		now,
		range: target.range,
	})
	return result.status === 'ok'
}

/**
 * Opt-in Payload task that pre-runs the dashboard's widget reads through the surfacing
 * engine so `payload.kv` is warm before a user opens the dashboard. Targets are derived
 * from `layout` (the app's `defaultLayout`, captured at registration and resolved here);
 * each read is isolated so one failing provider does not abort the rest. Most valuable
 * for slow or rate-limited provider adapters; native reads are cheap and harmless to warm.
 */
export const warmTask = (
	cron: string,
	layout: WarmLayout
): TaskConfig<{ input: Record<string, never>; output: { warmed: number; failed: number } }> => ({
	slug: WARM_TASK_SLUG,
	handler: async ({ req }) => {
		const targets = deriveWarmTargets(await resolveLayout(layout, req))
		const now = new Date()
		let warmed = 0
		let failed = 0
		for (const target of targets) {
			try {
				if (await runTarget(target, req, now)) {
					warmed++
				}
			} catch (err) {
				failed++
				req.payload.logger.warn(
					`analytics warm-cache: ${target.kind} read for "${target.metric}" failed: ${String(err)}`
				)
			}
		}
		return { output: { warmed, failed } }
	},
	schedule: [{ cron, queue: 'default' }],
})
