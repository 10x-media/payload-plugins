import type { CapabilityRequirement, SerializedCapabilities } from '../../core/capabilities'
import type { WireSource } from './fetchSources'

export interface SelectOption {
	value: string
	label: unknown
}

/** satisfiesCapabilities over the wire form (arrays instead of Sets). */
export const satisfiesSerialized = (
	caps: SerializedCapabilities,
	req: CapabilityRequirement
): boolean => {
	if (req.realtime && !caps.realtime) return false
	if (req.perPageQuery && !caps.perPageQuery) return false
	if (req.metrics?.some((m) => !caps.metrics.includes(m))) return false
	if (req.dimensions?.some((d) => !caps.dimensions.includes(d))) return false
	if (req.filters?.some((d) => !caps.filters.includes(d))) return false
	if (req.filterOperators?.some((op) => !caps.filterOperators.includes(op))) return false
	return true
}

/**
 * Options for the metric picker, narrowed to what the selected source can
 * serve. An unknown source id (a stale value, a source the endpoint could not
 * list) keeps the full static list, mirroring the server-side filterOptions
 * fallback, and a source that cannot meet the widget's extra requirements at
 * all falls back to the full list rather than an empty picker.
 */
export const narrowMetricOptions = (args: {
	options: SelectOption[]
	sources: WireSource[]
	sourceId: string | undefined
	requires?: Omit<CapabilityRequirement, 'metrics'>
}): SelectOption[] => {
	const src = args.sourceId ? args.sources.find((s) => s.id === args.sourceId) : undefined
	if (!src) return args.options
	if (args.requires && !satisfiesSerialized(src.capabilities, args.requires)) {
		return args.options
	}
	const narrowed = args.options.filter((o) =>
		satisfiesSerialized(src.capabilities, { ...args.requires, metrics: [o.value as never] })
	)
	return narrowed.length > 0 ? narrowed : args.options
}
