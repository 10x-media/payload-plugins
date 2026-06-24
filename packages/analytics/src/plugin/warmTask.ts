import type { DateRange, DimensionKey, MetricKey } from '../core/contract'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { breakdownSpecBySlug } from '../widgets/breakdownTypes'
import { resolveCustomRange } from '../widgets/range'
import type { WidgetRange } from '../widgets/types'

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

const asMetric = (v: unknown): MetricKey => (typeof v === 'string' ? (v as MetricKey) : 'pageviews')

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
