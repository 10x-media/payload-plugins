import {
	type CapabilityRequirement,
	meetsFilter,
	metricsReach,
	type SerializedCapabilities,
} from '../../core/capabilities'
import { isMetricKey } from '../../core/guards'
import type { WireSource } from './fetchSources'

interface SelectOption {
	value: string
	label: unknown
}

/** satisfiesCapabilities over the wire form (arrays instead of Sets). */
export const satisfiesSerialized = (
	caps: SerializedCapabilities,
	req: CapabilityRequirement
): boolean => {
	if (req.realtime && !caps.realtime) return false
	if (req.perItemQuery && caps.perItemQuery !== true) return false
	if (req.metrics?.some((m) => !caps.metrics.includes(m))) return false
	if (req.dimensions?.some((d) => !caps.dimensions.includes(d))) return false
	if (req.filters?.some((wanted) => !meetsFilter(caps, wanted))) return false
	return metricsReach(caps, req)
}

/**
 * Metric options narrowed to what the selected source serves. An unknown source, or one that
 * cannot meet `requires` at all, keeps the full list rather than an empty picker.
 */
export const narrowMetricOptions = <O extends SelectOption>(args: {
	options: O[]
	sources: WireSource[]
	sourceId: string | undefined
	requires?: Omit<CapabilityRequirement, 'metrics'>
}): O[] => {
	const src = args.sourceId ? args.sources.find((s) => s.id === args.sourceId) : undefined
	if (!src) return args.options
	if (args.requires && !satisfiesSerialized(src.capabilities, args.requires)) {
		return args.options
	}
	const narrowed = args.options.filter(
		(o) =>
			isMetricKey(o.value) &&
			satisfiesSerialized(src.capabilities, { ...args.requires, metrics: [o.value] })
	)
	return narrowed.length > 0 ? narrowed : args.options
}
