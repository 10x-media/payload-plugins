import type { PayloadRequest } from 'payload'
import { addCalendarDays, type CalendarDay } from '../../timeframe/calendar'
import { CHANNEL_TAXONOMY_VERSION, classifyChannel } from '../ingest/source'
import type { ChannelTuple, EventStore, StateStore } from '../store/types'
import { datesOf, daySpan, isFixed, lastClosedDay, windowOf } from './days'
import type { DaysTarget } from './engine'
import { runsOf } from './planner'

/** A stretch of days to count again: one scope's or every scope's, reclassified first or not. */
export interface RebuildDaysInput {
	/** One scope; every scope with hits when absent. Ignored on an unscoped install. */
	scope?: string
	from: Date
	/** Exclusive. */
	to: Date
	/** Classify the hits decided under an older channel taxonomy again before counting. */
	reclassify?: boolean
}

export interface RebuildDaysReport {
	/** Hits whose channel was classified again. */
	reclassified: number
	/** Days marked to be counted again. */
	dirty: number
}

interface RebuildDeps {
	store: EventStore
	state: StateStore
	/** The scopes a rebuild without one covers. */
	scopes: () => Promise<string[]>
	/** Whether a scope named in the input is read at all: an unscoped install reads `''` alone. */
	scoped: boolean
	zoneOf: (scope: string, req?: PayloadRequest) => Promise<string | null>
	probe: (
		target: DaysTarget,
		run: readonly [CalendarDay, CalendarDay]
	) => Promise<{ hits: CalendarDay[]; none: CalendarDay[] }>
	now: () => Date
}

/** The channel a stored tuple classifies into under the current taxonomy. */
export const classifyTuple = (tuple: ChannelTuple): string =>
	classifyChannel({
		referrerHost: tuple.ref ?? undefined,
		utmSource: tuple.utmSource ?? undefined,
		utmMedium: tuple.utmMedium ?? undefined,
		clickId: tuple.clickId ?? undefined,
	})

/** A rebuild's input checked: two instants, the first before the second. */
export const checkRebuildInput = (input: RebuildDaysInput): RebuildDaysInput => {
	const valid = (value: unknown): value is Date =>
		value instanceof Date && !Number.isNaN(value.getTime())
	if (!valid(input.from) || !valid(input.to) || input.from >= input.to) {
		throw new Error('analytics: a rebuild needs from and to, two instants with from before to')
	}
	if (input.scope !== undefined && typeof input.scope !== 'string') {
		throw new Error('analytics: a rebuild’s scope is a scope id')
	}
	return input
}

/**
 * Reclassifies the window's hits of an older channel taxonomy when asked, then marks dirty every
 * closed day holding hits; a fixed day keeps its totals, its raw hits partly gone (see `isFixed`).
 */
export const rebuildRange = async (
	deps: RebuildDeps,
	input: RebuildDaysInput,
	req?: PayloadRequest
): Promise<RebuildDaysReport> => {
	const { from, to } = checkRebuildInput(input)
	const scopes = !deps.scoped
		? ['']
		: input.scope !== undefined
			? [input.scope]
			: await deps.scopes()
	let reclassified = 0
	if (input.reclassify === true) {
		for (const scope of scopes) {
			reclassified += await deps.store.reclassify({
				scope,
				start: from,
				end: to,
				version: CHANNEL_TAXONOMY_VERSION,
				classify: classifyTuple,
			})
		}
	}
	let dirty = 0
	const now = deps.now()
	for (const scope of scopes) {
		const tz = await deps.zoneOf(scope, req)
		if (tz === null) {
			throw new Error(
				`analytics: the reporting timezone of scope "${scope}" could not be resolved, so its days cannot be counted again yet`
			)
		}
		const span = daySpan(from, to, tz)
		if (!span) {
			continue
		}
		const first = span.first
		const last = Math.min(span.last, lastClosedDay(now, tz))
		if (first > last) {
			continue
		}
		const prunedBefore = await deps.state.prunedBefore(scope)
		const markers = new Map(
			(await deps.state.markers(scope, addCalendarDays(first, -1), last)).map((marker) => [
				marker.day,
				marker,
			])
		)
		const startOf = (day: CalendarDay): Date => windowOf(day, { tz, markers, prunedBefore }).start
		const countable = datesOf(first, last).filter((day) => !isFixed(markers.get(day), prunedBefore))
		const hits: CalendarDay[] = []
		for (const run of runsOf(countable)) {
			hits.push(...(await deps.probe({ scope, tz, startOf }, run)).hits)
		}
		if (hits.length === 0) {
			continue
		}
		await deps.state.ensureMarkers(hits.map((day) => ({ scope, day, tz })))
		await deps.state.markDirty(scope, hits)
		dirty += hits.length
	}
	return { reclassified, dirty }
}
