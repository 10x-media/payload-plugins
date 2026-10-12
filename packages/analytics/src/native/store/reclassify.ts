import { isRecord } from '../../core/values'
import { stringOf } from './columnValues'
import type { ChannelTuple, ReclassifyRun } from './types'

/** Tuples one statement matches at most: four parameters each, well under any database's limit. */
export const RECLASSIFY_TUPLES = 50

/** How much of a window one statement updates: a day, so none holds more than a day's rows. */
const RECLASSIFY_SLICE_MS = 86_400_000

/** A stored row's tuple, an absent field read as null, so it matches the row it came from. */
export const channelTupleOf = (row: unknown): ChannelTuple => {
	const fields = isRecord(row) ? row : {}
	return {
		ref: stringOf(fields.ref),
		utmSource: stringOf(fields.utmSource),
		utmMedium: stringOf(fields.utmMedium),
		clickId: stringOf(fields.clickId),
	}
}

/** One key per distinct tuple, null kept apart from an empty string. */
export const tupleKey = (tuple: ChannelTuple): string =>
	JSON.stringify([tuple.ref, tuple.utmSource, tuple.utmMedium, tuple.clickId])

/**
 * Each channel the tuples classify into now, with the distinct tuples that do, in the order first
 * met: one statement per channel then updates every hit of those tuples at once.
 */
export const channelGroups = (
	tuples: readonly ChannelTuple[],
	classify: ReclassifyRun['classify']
): Map<string, ChannelTuple[]> => {
	const seen = new Set<string>()
	const groups = new Map<string, ChannelTuple[]>()
	for (const tuple of tuples) {
		const key = tupleKey(tuple)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		const channel = classify(tuple)
		const group = groups.get(channel)
		if (group) {
			group.push(tuple)
		} else {
			groups.set(channel, [tuple])
		}
	}
	return groups
}

/** `[start, end)` cut into pieces of at most `sliceMs`, oldest first. */
export const windowSlices = (
	start: Date,
	end: Date,
	sliceMs: number = RECLASSIFY_SLICE_MS
): Array<{ start: Date; end: Date }> => {
	const slices: Array<{ start: Date; end: Date }> = []
	for (let from = start.getTime(); from < end.getTime(); from += sliceMs) {
		slices.push({ start: new Date(from), end: new Date(Math.min(from + sliceMs, end.getTime())) })
	}
	return slices
}
