import type { PayloadRequest } from 'payload'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
} from '../../timeframe/calendar'
import { DEFAULT_TIMEZONE, isValidTimeZone, startOfHourInTz } from '../../timeframe/tz'
import { dayEnd, dayFinalAfter, SETTLE_MS } from '../store/state'
import type { DayMarker } from '../store/types'
import { keepRecent } from './recent'

/** One local day of a scope: its date, and the instants it runs between in the scope's zone. */
export interface LocalDay {
	day: CalendarDay
	start: Date
	/** The next day's first instant, 23 or 25 hours on across a daylight saving change. */
	end: Date
}

export const localDay = (day: CalendarDay, tz: string): LocalDay => ({
	day,
	start: calendarDayStart(day, tz),
	end: dayEnd(day, tz),
})

/** The first and last date `[start, end)` touches in a zone. */
interface DaySpan {
	first: CalendarDay
	last: CalendarDay
}

/** The dates `[start, end)` touches in `tz`, or null for an empty range. */
export const daySpan = (start: Date, end: Date, tz: string): DaySpan | null =>
	end > start
		? { first: calendarDayOf(start, tz), last: calendarDayOf(new Date(end.getTime() - 1), tz) }
		: null

/**
 * Files a scope's local day under its date, clamped to the range's dates in `tz`: a zone behind or
 * ahead of the reporting one has days dated outside it, and its buckets must still sum to totals.
 */
export const fileDayWithin = (
	range: { start: Date; end: Date },
	tz: string
): ((day: CalendarDay) => CalendarDay) => {
	const span = daySpan(range.start, range.end, tz)
	if (span === null) {
		return (day) => day
	}
	return (day) => (day < span.first ? span.first : day > span.last ? span.last : day)
}

/** Every date from `first` through `last`; none when `last` comes first. */
export const datesOf = (first: CalendarDay, last: CalendarDay): CalendarDay[] => {
	const dates: CalendarDay[] = []
	for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
		dates.push(day)
	}
	return dates
}

/**
 * Every local day `[start, end)` touches in `tz`, oldest first, each in full. Steps run on dates,
 * so a daylight saving change never skips or repeats a day.
 */
export const localDaysOf = (start: Date, end: Date, tz: string): LocalDay[] => {
	const span = daySpan(start, end, tz)
	return span ? datesOf(span.first, span.last).map((day) => localDay(day, tz)) : []
}

export const todayIn = (now: Date, tz: string): CalendarDay => calendarDayOf(now, tz)

/** Whether a day is over and the beacons that arrive late for it have had time to: it settled. */
export const isClosed = (day: LocalDay, now: Date): boolean =>
	now.getTime() >= day.end.getTime() + SETTLE_MS

/** The latest date closed in `tz` at `now`: yesterday, or the day before in its first minutes. */
export const lastClosedDay = (now: Date, tz: string): CalendarDay => {
	const yesterday = addCalendarDays(todayIn(now, tz), -1)
	return isClosed(localDay(yesterday, tz), now) ? yesterday : addCalendarDays(yesterday, -1)
}

/**
 * Whether no hit can still arrive for a day: an engagement is filed up to a day before it arrives,
 * so this is once the day turns final, its end plus a day and a quarter hour.
 */
export const isSealed = (day: CalendarDay, tz: string, now: Date): boolean =>
	now >= dayFinalAfter(day, tz)

/** The oldest date raw hits are read for: the last `rawDays` dates, today counted. */
export const rawFloorDay = (today: CalendarDay, rawDays: number): CalendarDay =>
	addCalendarDays(today, 1 - rawDays)

/**
 * The first instant raw hits are read from in `tz`: the start of {@link rawFloorDay}, or null
 * when every hit is kept. Pruning never deletes a hit after it.
 */
export const rawFloor = (now: Date, tz: string, rawDays: number | null): Date | null =>
	rawDays === null ? null : calendarDayStart(rawFloorDay(todayIn(now, tz), rawDays), tz)

/** The zone whose date comes last, UTC-12, and the one whose day starts first, UTC+14. */
export const WESTMOST_ZONE = 'Etc/GMT+12'
export const EASTMOST_ZONE = 'Pacific/Kiritimati'

/**
 * The raw floor of a scope whose zone is unknown: the floor date of the westmost zone, started
 * in the eastmost one, which no zone's own {@link rawFloor} is earlier than.
 */
export const zoneFreeRawFloor = (now: Date, rawDays: number | null): Date | null =>
	rawDays === null
		? null
		: calendarDayStart(rawFloorDay(todayIn(now, WESTMOST_ZONE), rawDays), EASTMOST_ZONE)

/** Where a completed marker's count started: its recorded start, else its day's start in its tz. */
export const markerStart = (marker: DayMarker): Date =>
	marker.start ?? calendarDayStart(marker.day, marker.tz)

/** Where a marker's count ends: the next day's start in its zone. */
export const markerEnd = (marker: DayMarker): Date => dayEnd(marker.day, marker.tz)

/**
 * Whether a marker's count is fixed: it started before the scope's raw hits were cut, so part of
 * what it counted is gone from them and it is never counted again, in this zone or another.
 */
export const isFixed = (marker: DayMarker | undefined, prunedBefore: Date | null): boolean =>
	marker !== undefined &&
	prunedBefore !== null &&
	marker.aggregatedAt !== null &&
	marker.status !== 'open' &&
	markerStart(marker) < prunedBefore

/** One scope's days as their windows are read: its zone, its markers by day, and its cut. */
interface ScopeDays {
	tz: string
	markers: ReadonlyMap<CalendarDay, DayMarker>
	/** Before it the scope's raw hits may be gone; null while none ever were. */
	prunedBefore: Date | null
}

/**
 * A day's window in its scope's zone: its own, or from where the day before's count ended when
 * that one is fixed, so after a zone change the two never overlap and leave no gap between them.
 */
export const windowOf = (day: CalendarDay, of: ScopeDays): LocalDay => {
	const own = localDay(day, of.tz)
	const previous = of.markers.get(addCalendarDays(day, -1))
	if (previous === undefined || !isFixed(previous, of.prunedBefore)) {
		return own
	}
	const start = markerEnd(previous)
	return { day, start: start > own.end ? own.end : start, end: own.end }
}

/**
 * The start of every local hour from the one holding `start` up to `end`, in `tz`: each step
 * floors again, so a daylight saving change or a half-hour zone keeps the series on its hours.
 */
export const hourStarts = (start: Date, end: Date, tz: string): Date[] => {
	const starts: Date[] = []
	for (
		let at = startOfHourInTz(start, tz);
		at < end;
		at = startOfHourInTz(new Date(at.getTime() + 90 * 60_000), tz)
	) {
		starts.push(at)
	}
	return starts
}

/**
 * Where a scope's reporting zone comes from: a zone name, or a throw when it cannot say. `req` is
 * the request asking, when there is one to resolve it with (a job's).
 */
export type ZoneSource = (scope: string, req?: PayloadRequest) => string | Promise<string>

/** A scope's zone for a read: a stand-in when it has none, which the read writes nothing in. */
interface ReadZone {
	tz: string
	/** No zone resolved or was ever recorded: the read is cut in UTC, as its hits were hashed. */
	standIn: boolean
}

interface ReadZones {
	/** The zone the read names itself when that is a zone, else UTC. */
	readonly named: string
	/** A scope's zone, asked of the source once per read. */
	of(scope: string): Promise<ReadZone>
}

interface ZoneBook {
	/** The zones of one read; `named` is the zone it names, used without a source at all. */
	forRead(named?: string): ReadZones
	/**
	 * A scope's zone for counting its days: the source's, else its last good one, else the zone
	 * its newest counted day was counted in, else null, never a stand-in. With no source, UTC.
	 */
	strict(scope: string, req?: PayloadRequest): Promise<string | null>
}

/**
 * A scope whose zone fails keeps its last good one (remembered or recorded), never UTC, which would
 * count its days again in another zone. With neither it is read in UTC and nothing is written.
 */
export const createZoneBook = (
	source: ZoneSource | undefined,
	warn: (message: string) => void,
	recorded: (scope: string) => Promise<string | null> = async () => null
): ZoneBook => {
	const lastGood = new Map<string, string>()
	// A scope that never resolves is warned about without a last good zone, so this map is bounded too.
	const warned = new Map<string, true>()

	const keep = (scope: string, tz: string): void => {
		keepRecent(lastGood, [scope, tz], (oldest) => warned.delete(oldest))
	}

	/** The last good zone of a scope whose source failed: remembered, else recorded, else null. */
	const fallback = async (scope: string): Promise<string | null> => {
		const remembered = lastGood.get(scope)
		if (remembered !== undefined) {
			return remembered
		}
		const stored = await recorded(scope).catch(() => null)
		if (stored !== null && isValidTimeZone(stored)) {
			keep(scope, stored)
			return stored
		}
		return null
	}

	/** The source's zone for a scope, kept as its last good one; a failure, with what stands in. */
	const resolve = async (
		scope: string,
		ask: { from: ZoneSource; req?: PayloadRequest; standIn: string | null }
	): Promise<ReadZone | null> => {
		try {
			const tz = await ask.from(scope, ask.req)
			if (!isValidTimeZone(tz)) {
				throw new Error(`"${tz}" is not an IANA time zone`)
			}
			keep(scope, tz)
			warned.delete(scope)
			return { tz, standIn: false }
		} catch (err) {
			const kept = await fallback(scope)
			if (!warned.has(scope)) {
				keepRecent(warned, [scope, true])
				warn(
					`analytics: the reporting timezone of scope "${scope}" could not be resolved, so ${
						kept !== null
							? `it is read in ${kept}, the zone it was last counted in`
							: ask.standIn === null
								? 'its days are not counted until it is'
								: `it is read in ${ask.standIn} and nothing is counted until it is`
					}: ${String(err)}`
				)
			}
			if (kept !== null) {
				return { tz: kept, standIn: false }
			}
			return ask.standIn === null ? null : { tz: ask.standIn, standIn: true }
		}
	}

	return {
		strict: async (scope, req) =>
			source
				? ((await resolve(scope, { from: source, ...(req ? { req } : {}), standIn: null }))?.tz ??
					null)
				: DEFAULT_TIMEZONE,
		forRead(named) {
			const zone = named !== undefined && isValidTimeZone(named) ? named : DEFAULT_TIMEZONE
			const memo = new Map<string, Promise<ReadZone>>()
			return {
				named: zone,
				of(scope) {
					const known = memo.get(scope)
					if (known) {
						return known
					}
					const resolved: Promise<ReadZone> = source
						? resolve(scope, { from: source, standIn: DEFAULT_TIMEZONE }).then(
								(found) => found ?? { tz: DEFAULT_TIMEZONE, standIn: true }
							)
						: Promise.resolve({ tz: zone, standIn: false })
					memo.set(scope, resolved)
					return resolved
				},
			}
		},
	}
}
