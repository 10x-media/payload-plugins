import { isRecord } from '../../core/values'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayStart,
	formatCalendarDay,
} from '../../timeframe/calendar'
import { DAY_MS } from '../../timeframe/tz'
import { dateOf, jsonOf, numberOf, stringOf } from './columnValues'
import type { DayMarker, DayStatus, DropNote } from './types'

const STATE_KINDS = [
	'salt',
	'day',
	'lease',
	'heartbeat',
	'pruned',
	'drop',
	'epoch',
	'cursor',
] as const

export type StateKind = (typeof STATE_KINDS)[number]

const DAY_STATUSES: readonly DayStatus[] = [
	'open',
	'partial',
	'provisional',
	'final',
	'empty',
	'dirty',
	'failed',
]

/** `salt:2026-10-05`: one salt per calendar date, shared by every scope. */
export const saltKey = (day: CalendarDay): string => `salt:${formatCalendarDay(day)}`

/** `day:<scope>:20261005`, the date in the scope's zone (`day::20261005` for no scope). */
export const dayKey = (scope: string, day: CalendarDay): string => `day:${scope}:${day}`

/** `lease:maintain`. */
export const leaseKey = (name: string): string => `lease:${name}`

/** The name of the lease one maintenance run holds across every instance. */
export const MAINTAIN_LEASE_NAME = 'maintain'

/** `heartbeat:analytics-maintain`, named after the task. */
export const heartbeatKey = (task: string): string => `heartbeat:${task}`

/** `pruned:<scope>`: where the scope's raw hits were last cut. */
export const prunedKey = (scope: string): string => `pruned:${scope}`

/** `epoch:<scope>`: the config token `refreshProviders()` replaces (`epoch:` for no scope). */
export const epochStateKey = (scope: string): string => `epoch:${scope}`

/** `cursor:analytics-sync`: where a task's last run stopped, named after the task. */
export const cursorKey = (task: string): string => `cursor:${task}`

/** `drop:<scope>:20261005:<gen>`, one per run that writes beside a day's readable rows. */
export const dropKey = (note: DropNote): string => `drop:${note.scope}:${note.day}:${note.gen}`

/** The kind a key's prefix names, undefined for a key of no known kind. */
export const stateKindOf = (key: string): StateKind | undefined => {
	const colon = key.indexOf(':')
	const prefix = colon > 0 ? key.slice(0, colon) : ''
	return STATE_KINDS.find((kind) => kind === prefix)
}

/** How long a closed day waits for late beacons before it is aggregated. */
export const SETTLE_MS = 15 * 60_000

/** How long after its end a day is aggregated a last time and turns final. */
const FINAL_AFTER_MS = DAY_MS + SETTLE_MS

/** A salt is deleted when this many UTC days have begun after its own. */
const SALT_KEEP_DAYS = 3

/** How long a day's lease lasts: a run that froze holding one lets the next in after this. */
export const DAY_LEASE_MS = 10 * 60_000

/** A lease's duration, refused unless it is a finite number of milliseconds above zero. */
export const leaseTtl = (ttlMs: number): number => {
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		throw new RangeError(`analytics: a lease needs a duration above zero, got ${ttlMs}`)
	}
	return ttlMs
}

export const leaseUntilFrom = (now: Date, ttlMs: number): Date =>
	new Date(now.getTime() + leaseTtl(ttlMs))

/** The instant a local day ends in `tz`, which is the next day's start rather than 24 hours on. */
export const dayEnd = (day: CalendarDay, tz: string): Date =>
	calendarDayStart(addCalendarDays(day, 1), tz)

export const dayFinalAfter = (day: CalendarDay, tz: string): Date =>
	new Date(dayEnd(day, tz).getTime() + FINAL_AFTER_MS)

export const saltExpiresAt = (day: CalendarDay): Date =>
	calendarDayStart(addCalendarDays(day, SALT_KEEP_DAYS), 'UTC')

/**
 * The latest `finalAfter` an open day may carry to be due at `now`: it ended at least a quarter
 * hour ago, `finalAfter` being its end plus {@link FINAL_AFTER_MS}.
 */
export const openDueBy = (now: Date): Date => new Date(now.getTime() + FINAL_AFTER_MS - SETTLE_MS)

/** Whether a task's fallback should step in: its last beat is more than two intervals old. */
export const heartbeatStale = (last: Date | null, intervalMs: number, now: Date): boolean =>
	last === null || now.getTime() - last.getTime() > 2 * intervalMs

/** Refuses a `pending` or `drops` limit that is no whole number of at least 1. */
export const checkStateLimit = (read: 'pending' | 'drops', limit: number): number => {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError(`analytics: ${read} needs a whole limit of at least 1, got ${limit}`)
	}
	return limit
}

/** Every date from `from` through `to`; none when `to` comes first. */
export const daysFrom = (from: CalendarDay, to: CalendarDay): CalendarDay[] => {
	const days: CalendarDay[] = []
	for (let day = from; day <= to; day = addCalendarDays(day, 1)) {
		days.push(day)
	}
	return days
}

const dayStatusOf = (value: unknown): DayStatus | undefined =>
	DAY_STATUSES.find((status) => status === value)

/**
 * What a marker keeps in its `value`: where its count started when not at midnight, and the counts
 * started since its last one; null for neither.
 */
export const markerValue = (
	marker: Pick<DayMarker, 'start' | 'failures'>
): { start?: string; failures?: number } | null => {
	const failures = marker.failures ?? 0
	if (marker.start === null && failures === 0) {
		return null
	}
	return {
		...(marker.start === null ? {} : { start: marker.start.toISOString() }),
		...(failures === 0 ? {} : { failures }),
	}
}

const failuresOf = (value: unknown): number => {
	const failures = isRecord(value) ? value.failures : undefined
	return typeof failures === 'number' && Number.isInteger(failures) && failures > 0 ? failures : 0
}

/** A marker out of a row keyed by field name, null for a row that holds none. */
export const markerOf = (row: Record<string, unknown>): DayMarker | null => {
	const day = numberOf(row.day)
	const status = dayStatusOf(row.status)
	if (typeof row.scope !== 'string' || day === null || typeof row.tz !== 'string' || !status) {
		return null
	}
	const value = jsonOf(row.value)
	const failures = failuresOf(value)
	return {
		scope: row.scope,
		day,
		tz: row.tz,
		start: isRecord(value) ? dateOf(value.start) : null,
		status,
		version: numberOf(row.version),
		gen: stringOf(row.gen),
		hits: numberOf(row.hits),
		leaseOwner: stringOf(row.leaseOwner),
		leaseUntil: dateOf(row.leaseUntil),
		finalAfter: dateOf(row.finalAfter),
		aggregatedAt: dateOf(row.aggregatedAt),
		...(failures === 0 ? {} : { failures }),
	}
}

/** A drop note out of a row keyed by field name, null for a row that holds none. */
export const dropOf = (row: Record<string, unknown>): DropNote | null => {
	const day = numberOf(row.day)
	return typeof row.scope === 'string' && day !== null && typeof row.gen === 'string'
		? { scope: row.scope, day, gen: row.gen }
		: null
}

/** The markers among rows read back keyed by field name, skipping any row that holds none. */
export const markersOf = (rows: unknown): DayMarker[] =>
	Array.isArray(rows)
		? rows.flatMap((row) => {
				const marker = isRecord(row) ? markerOf(row) : null
				return marker ? [marker] : []
			})
		: []

/** The instant a heartbeat or a prune record keeps in its `value`, `{ at }`. */
export const atOf = (value: unknown): Date | null => {
	const parsed = jsonOf(value)
	return isRecord(parsed) ? dateOf(parsed.at) : null
}

/** The cursor in a `cursor:` row's value, `{ cursor }`; null for a finished run or none. */
export const cursorOf = (value: unknown): string | null => {
	const parsed = jsonOf(value)
	return isRecord(parsed) && typeof parsed.cursor === 'string' ? parsed.cursor : null
}

/** The token in an `epoch:` row's value, `{ token }`. */
export const tokenOf = (value: unknown): string | null => {
	const parsed = jsonOf(value)
	return isRecord(parsed) && typeof parsed.token === 'string' && parsed.token !== ''
		? parsed.token
		: null
}
