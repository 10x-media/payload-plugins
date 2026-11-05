import { currentDate } from '../../core/clock'
import { addCalendarDays, type CalendarDay, calendarDayOf } from '../../timeframe/calendar'
import { TimezoneResolutionError } from '../../timeframe/reportingTimezone'
import { DEFAULT_TIMEZONE, isValidTimeZone } from '../../timeframe/tz'
import type { StateStore } from '../store/types'
import { keepRecent } from './recent'

/**
 * Days whose salts stay in memory: the three dates a moment can fall on somewhere between UTC-12
 * and UTC+14, and the one created ahead of midnight.
 */
export const MAX_CACHED_DAYS = 4

/** The salt a hit is hashed with, and the local day it belongs to. */
interface HitSalt {
	day: CalendarDay
	tz: string
	salt: string
}

interface HitTime {
	scope: string
	at: Date
	/** The scope's reporting zone; it may throw, or answer something that is no zone. */
	zone: () => string | Promise<string>
}

export interface DailySalts {
	/** The salt of the local day `at` falls on in the scope's zone. */
	forHit(hit: HitTime): Promise<HitSalt>
	/**
	 * A day's salt; the first fetch of a day also creates the next one's, and the first of a later
	 * day than any before deletes the expired ones.
	 */
	forDay(day: CalendarDay): Promise<string>
}

interface DailySaltsOptions {
	state: Pick<StateStore, 'salt' | 'sweep'>
	warn?: (message: string) => void
	/**
	 * The zone a scope's newest counted day was counted in: its last good zone when the source
	 * fails in a process that never resolved it, so hits hash by the days reads cut.
	 */
	recorded?: (scope: string) => Promise<string | null>
	/** The clock salts expire by; the plugin's clock (`currentDate`) by default. */
	now?: () => Date
}

/**
 * A hit's salt: its local day's, or its UTC day's (the zone such a scope is read in) while its zone
 * never resolved nor was recorded; `unresolved` hears each time. Its counted day is set at read.
 */
export const saltForHit = async (
	salts: Pick<DailySalts, 'forHit' | 'forDay'>,
	hit: HitTime,
	unresolved: (err: TimezoneResolutionError) => void
): Promise<string> => {
	try {
		return (await salts.forHit(hit)).salt
	} catch (err) {
		if (!(err instanceof TimezoneResolutionError)) {
			throw err
		}
		unresolved(err)
		return salts.forDay(calendarDayOf(hit.at, DEFAULT_TIMEZONE))
	}
}

/**
 * A scope whose zone fails keeps its last good one (remembered or recorded), never UTC, else throws
 * `TimezoneResolutionError`. Expired salts are deleted so a past day's hashes cannot be recomputed.
 */
export const createDailySalts = (options: DailySaltsOptions): DailySalts => {
	const salts = new Map<CalendarDay, Promise<string>>()
	const lastZones = new Map<string, string>()
	const warned = new Set<string>()
	const now = options.now ?? currentDate
	let sweptThrough: CalendarDay | undefined

	const sweepExpired = (): void => {
		void options.state.sweep(now()).catch((err: unknown) => {
			options.warn?.(`analytics: deleting expired visitor salts failed: ${String(err)}`)
		})
	}

	const load = (day: CalendarDay): Promise<string> => {
		const cached = salts.get(day)
		if (cached) {
			return cached
		}
		const loading = options.state.salt(day)
		salts.set(day, loading)
		loading.catch(() => {
			if (salts.get(day) === loading) {
				salts.delete(day)
			}
		})
		while (salts.size > MAX_CACHED_DAYS) {
			salts.delete(Math.min(...salts.keys()))
		}
		return loading
	}

	const remember = (scope: string, tz: string): void => {
		warned.delete(scope)
		keepRecent(lastZones, [scope, tz], (oldest) => warned.delete(oldest))
	}

	const zoneOf = async (hit: HitTime): Promise<string> => {
		try {
			const tz = await hit.zone()
			if (!isValidTimeZone(tz)) {
				throw new Error(`"${tz}" is not an IANA time zone`)
			}
			remember(hit.scope, tz)
			return tz
		} catch (err) {
			let last = lastZones.get(hit.scope)
			if (last === undefined && options.recorded) {
				const stored = await options.recorded(hit.scope).catch(() => null)
				if (stored !== null && isValidTimeZone(stored)) {
					last = stored
					keepRecent(lastZones, [hit.scope, stored], (oldest) => warned.delete(oldest))
				}
			}
			if (last === undefined) {
				throw err instanceof TimezoneResolutionError
					? err
					: new TimezoneResolutionError(
							`analytics: the reporting timezone of scope "${hit.scope}" could not be resolved: ${String(err)}`,
							undefined,
							err
						)
			}
			if (!warned.has(hit.scope)) {
				warned.add(hit.scope)
				options.warn?.(
					`analytics: the reporting timezone of scope "${hit.scope}" could not be resolved, so its hits keep the last good zone, ${last}: ${String(err)}`
				)
			}
			return last
		}
	}

	const forDay = (day: CalendarDay): Promise<string> => {
		const first = !salts.has(day)
		const salt = load(day)
		if (first) {
			void load(addCalendarDays(day, 1)).catch(() => undefined)
		}
		if (sweptThrough === undefined || day > sweptThrough) {
			sweptThrough = day
			sweepExpired()
		}
		return salt
	}

	return {
		forDay,
		async forHit(hit) {
			const tz = await zoneOf(hit)
			const day = calendarDayOf(hit.at, tz)
			return { day, tz, salt: await forDay(day) }
		},
	}
}
