import type { PayloadRequest } from 'payload'
import { isRecord } from '../../core/values'
import { MAX_SINCE_MS } from '../../goals/constants'
import { underLease } from '../../maintenance/underLease'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
} from '../../timeframe/calendar'
import { AGGREGATION_VERSION } from '../store/aggregate'
import { dateOf, jsonOf } from '../store/columnValues'
import { compareCodePoints } from '../store/rawRead'
import { DAY_LEASE_MS, dayKey, leaseKey, MAINTAIN_LEASE_NAME } from '../store/state'
import type { DayMarker, DayStatus, EventStore, OrderKey, StateStore } from '../store/types'
import { MAINTAIN_TASK_SLUG } from '../tasks/maintainTask'
import { DEFAULT_RAW_DAYS } from './capabilities'
import {
	datesOf,
	EASTMOST_ZONE,
	isFixed,
	isSealed,
	type LocalDay,
	lastClosedDay,
	markerStart,
	rawFloor,
	rawFloorDay,
	todayIn,
	WESTMOST_ZONE,
	windowOf,
	zoneFreeRawFloor,
} from './days'
import type { DayRun, DaysTarget, DayTarget } from './engine'
import { countedOver, runsOf, snapshotState } from './planner'
import type { RebuildDaysInput, RebuildDaysReport } from './rebuild'

/** The lease one maintenance run holds across every instance on the database. */
const MAINTAIN_LEASE = leaseKey(MAINTAIN_LEASE_NAME)

/** Rows one prune statement deletes at most. */
export const PRUNE_CHUNK = 5_000

/** How far below a cut a hit stored after it may land: an engagement's day reach, and a margin. */
const LATE_HIT_REACH_MS = MAX_SINCE_MS + 15 * 60_000

/** How far ahead of the clock a stored hit may be dated, as far as a pass looks for new ones. */
const FUTURE_REACH_MS = 60 * 60_000

/** The cursor of a scope's raw prune: where its last finished prune stopped. */
const pruneCursor = (scope: string): string => `prune:${scope}`

/** Order records the sweep reads per statement. */
const ORDER_SWEEP_CHUNK = 1_000

/**
 * How far before a scope's last pass the order sweep, and the look for new hits, start: a record
 * lands late when SQLite held it for a host transaction, or a clock ran fast.
 */
const ORDER_SWEEP_REACH_MS = 15 * 60_000

/** Due days one page of the pending step reads. */
const PENDING_LIMIT = 500

/** The part of a run's budget the pending step may spend before the scopes get their turn. */
const PENDING_SHARE = 0.5

/** The part of a run's budget one scope's own counts may spend; the rest wait for its next turn. */
const SCOPE_COUNT_SHARE = 0.25

/** Drop notes one run finishes at most; the next run takes the rest. */
const DROPS_PER_RUN = 500

/**
 * Days without hits one run marks empty per scope, newest first, as a read does: each costs a
 * lease and a write, so a first run does not spend its budget on them before counting any day.
 */
const EMPTY_PER_RUN = 31

/** Counts maintenance starts on a day before it gives up and marks it failed. */
export const MAX_COUNT_ATTEMPTS = 3

/** The cursor the scopes' turns rotate by: the last scope a run took. */
const ROTATION_CURSOR = 'maintain-rotation'

/** The cursor of a scope's last full pass (see {@link PassStamp}). */
const passCursor = (scope: string): string => `maintain:${scope}`

/** A day not final yet: a later aggregation still reads its raw hits. */
const NOT_FINAL: ReadonlySet<DayStatus> = new Set(['open', 'partial', 'provisional', 'dirty'])

export interface MaintainInput {
	/** How long the run may work, in ms; it stops between steps and days once this is spent. */
	budgetMs: number
	/** The job's request, which the scopes' reporting timezones are resolved with. */
	req?: PayloadRequest
	/** A rebuild run first, whatever the budget, so the days it marks are counted in the same run. */
	rebuild?: RebuildDaysInput
	/** Records the run as `analytics-maintain`'s heartbeat: a runner's run does, a nudge never. */
	heartbeat?: boolean
	/**
	 * How long one statement may hold up this thread, where statements do: a day, or today's
	 * snapshot, whose count is predicted to take longer is left for a run without the bound.
	 */
	stallMs?: number
}

export interface MaintainReport {
	/** False when the engine was closed or another run held the maintenance lease. */
	ran: boolean
	/** Every step finished within the budget. */
	finished: boolean
	sweptSalts: number
	/** Aggregate rows of a generation their day's marker no longer names. */
	sweptRows: number
	rebuild?: RebuildDaysReport
	/** Markers created for closed days found holding hits. */
	discovered: number
	/** Days without hits marked empty. */
	empty: number
	aggregated: number
	/** Days whose aggregation failed; they stay due until counting them starts too often. */
	failed: number
	/** Days given up on, counting them having started `MAX_COUNT_ATTEMPTS` times in vain. */
	markedFailed: number
	/** Counts and snapshots left for a run without `stallMs`, being predicted to take longer. */
	deferred: number
	snapshots: number
	/** Order records swept since each scope's last pass, their twin's closed day looked at again. */
	sweptOrders: number
	/** Hits deleted, and order records turned into their tombstones. */
	prunedHits: number
	/** Order tombstones deleted with their days' totals. */
	expiredOrders: number
	prunedAggregates: number
	prunedMarkers: number
	/** Scopes looked at in full. */
	scopesPassed: number
	/** Scopes passed over: no hit and no new day since their last full pass. */
	scopesSkipped: number
}

interface MaintenanceDeps {
	store: EventStore
	state: StateStore
	/** Every scope with raw hits or day markers, `''` alone on an unscoped install. */
	scopes: () => Promise<string[]>
	/** Counts again the closed day of the other record of an order whose record `id` was stored. */
	orderStored: (scope: string, id: string) => Promise<void>
	/** A scope's zone, strictly: null when it neither resolves nor has a last good one. */
	zoneOf: (scope: string, req?: PayloadRequest) => Promise<string | null>
	/** Counts a closed day as one attempt, which gives up on it once too many came to nothing. */
	aggregate: (target: DayTarget) => Promise<DayRun>
	snapshot: (target: DayTarget) => Promise<DayRun>
	/** Whether counting the day is predicted to hold up the thread no longer than `stallMs`. */
	fits: (target: DayTarget, stallMs: number) => Promise<boolean>
	/** Marks days without hits empty, until `stop` answers true; answers how many it marked. */
	markEmpty: (
		target: DaysTarget,
		days: readonly CalendarDay[],
		stop: () => boolean
	) => Promise<number>
	/** Which dates of a run hold hits, probed in halves, its first day from `startOf`. */
	probe: (
		target: DaysTarget,
		run: readonly [CalendarDay, CalendarDay]
	) => Promise<{ hits: CalendarDay[]; none: CalendarDay[] }>
	rebuild: (input: RebuildDaysInput, req?: PayloadRequest) => Promise<RebuildDaysReport>
	rawDays: number | null
	aggregateDays: number | null
	today: {
		/** Whether a day still running holds too many hits to read live, so it is snapshotted. */
		busy: (target: DayTarget, window: LocalDay) => Promise<boolean>
		/** How long a snapshot that counted `hits` hits is served. */
		maxAgeMs: (hits: number) => number
	}
	/** Payload's clock: days are cut, leases stamped and heartbeats written by it. */
	now: () => Date
	/** Wall-clock milliseconds, which a budget is spent in. */
	clock: () => number
	/** False once the engine is closed: a run stops at its next step or day. */
	open: () => boolean
	/** A fresh lease owner for each lease a run takes. */
	owner: () => string
	warn: (message: string) => void
}

/** A day due for counting, in the zone and over the window it is counted in now. */
interface DueDay extends DayTarget {
	/** `probe`: an empty day cut in another zone or window, which may hold hits in this one. */
	via: 'aggregate' | 'probe'
}

interface DueArgs {
	/** A scope's markers, the day before the first one it is asked about included. */
	markers: readonly DayMarker[]
	tz: string
	now: Date
	lastClosed: CalendarDay
	/** Before it the scope's raw hits may be gone; null while none ever were. */
	prunedBefore: Date | null
}

/** The markers by day, so a day's window can read the one before it. */
const byDay = (markers: readonly DayMarker[]): ReadonlyMap<CalendarDay, DayMarker> =>
	new Map(markers.map((marker) => [marker.day, marker]))

/** How one closed day's marker is counted again, or null when it is counted as it should be. */
const viaOf = (marker: DayMarker, window: LocalDay, args: DueArgs): DueDay['via'] | null => {
	if (marker.status === 'failed' || isFixed(marker, args.prunedBefore)) {
		return null
	}
	if (NOT_FINAL.has(marker.status) && marker.status !== 'provisional') {
		return 'aggregate'
	}
	if (marker.status === 'provisional' && isSealed(marker.day, args.tz, args.now)) {
		return 'aggregate'
	}
	const current = countedOver(marker, args.tz, window)
	if (marker.status === 'empty') {
		return current ? null : 'probe'
	}
	return current ? null : 'aggregate'
}

/**
 * The closed days maintenance counts: never counted whole, dirty, provisional and sealed, or
 * counted another way (version, zone, window) while not fixed; never a day it gave up on.
 */
export const dueDays = (args: DueArgs): DueDay[] => {
	const markers = byDay(args.markers)
	return args.markers.flatMap((marker): DueDay[] => {
		if (marker.day > args.lastClosed) {
			return []
		}
		const window = windowOf(marker.day, { ...args, markers })
		const via = viaOf(marker, window, args)
		return via === null
			? []
			: [{ scope: marker.scope, day: marker.day, tz: args.tz, start: window.start, via }]
	})
}

/**
 * Where raw pruning stops: the retention floor, or the start of an older day still to be counted.
 * A fixed day, or one maintenance gave up on, never stops it; null keeps every hit.
 */
export const rawPruneCut = (args: {
	now: Date
	tz: string
	rawDays: number | null
	markers: readonly DayMarker[]
	prunedBefore: Date | null
}): Date | null => {
	let cut = rawFloor(args.now, args.tz, args.rawDays)
	if (cut === null) {
		return null
	}
	const markers = byDay(args.markers)
	for (const marker of args.markers) {
		if (marker.status === 'failed' || isFixed(marker, args.prunedBefore)) {
			continue
		}
		const window = windowOf(marker.day, { ...args, markers })
		if (!NOT_FINAL.has(marker.status) && countedOver(marker, args.tz, window)) {
			continue
		}
		for (const start of [markerStart(marker), window.start]) {
			if (start < cut) {
				cut = start
			}
		}
	}
	return cut
}

/**
 * The first day whose daily totals are kept: the last `aggregateDays` dates, today counted, or the
 * oldest day still to be counted when that comes first. Null keeps every day's totals.
 */
export const aggregatePruneDay = (args: {
	today: CalendarDay
	aggregateDays: number | null
	markers: readonly DayMarker[]
	prunedBefore: Date | null
}): CalendarDay | null => {
	if (args.aggregateDays === null) {
		return null
	}
	let first = rawFloorDay(args.today, args.aggregateDays)
	for (const marker of args.markers) {
		if (NOT_FINAL.has(marker.status) && !isFixed(marker, args.prunedBefore) && marker.day < first) {
			first = marker.day
		}
	}
	return first
}

/**
 * A scope's last passes: when the last whole one and the last finished order sweep started (null
 * for none), under which zone and settings. A scope whole since `at` with nothing new is skipped.
 */
interface PassStamp {
	at: Date | null
	swept: Date | null
	tz: string
	settings: string
}

const stampOf = (cursor: string | null): PassStamp | null => {
	const parsed = cursor === null ? undefined : jsonOf(cursor)
	if (!isRecord(parsed) || typeof parsed.tz !== 'string' || typeof parsed.settings !== 'string') {
		return null
	}
	return {
		at: dateOf(parsed.at),
		swept: dateOf(parsed.swept),
		tz: parsed.tz,
		settings: parsed.settings,
	}
}

const stampText = (stamp: PassStamp): string =>
	JSON.stringify({
		at: stamp.at?.toISOString() ?? null,
		swept: stamp.swept?.toISOString() ?? null,
		tz: stamp.tz,
		settings: stamp.settings,
	})

/** What one scope's discovery found, which the later steps of its pass work from. */
interface ScopeState {
	scope: string
	tz: string
	today: CalendarDay
	lastClosed: CalendarDay
	/** The oldest day the pass looks at: the oldest hit's, at most the retention floor's. */
	from: CalendarDay
	prunedBefore: Date | null
	/** Its markers from the day before `from` through today. */
	markers: DayMarker[]
	/** Every closed day with hits from `from` on has a marker, so pruning may follow it. */
	discovered: boolean
	/** Sealed days found without hits, newest first, to mark empty once the due days are counted. */
	empty: CalendarDay[]
}

/** One run's progress, shared by its steps. */
interface Run {
	now: Date
	report: MaintainReport
	going: () => boolean
	stallMs: number | undefined
	budgetMs: number
	/** Days the run already tried to count, so no page of pending days repeats one. */
	attempted: Set<string>
	zoneOf: (scope: string) => Promise<string | null>
}

const emptyReport = (): MaintainReport => ({
	ran: false,
	finished: false,
	sweptSalts: 0,
	sweptRows: 0,
	discovered: 0,
	empty: 0,
	aggregated: 0,
	failed: 0,
	markedFailed: 0,
	deferred: 0,
	snapshots: 0,
	sweptOrders: 0,
	prunedHits: 0,
	expiredOrders: 0,
	prunedAggregates: 0,
	prunedMarkers: 0,
	scopesPassed: 0,
	scopesSkipped: 0,
})

/**
 * The scheduled run: salts and dead rows swept, due days counted oldest first, then each scope in
 * turn from where the last run stopped. `lease:maintain` keeps a second run out.
 */
export const createMaintenance = (deps: MaintenanceDeps) => {
	const { store, state } = deps
	const settings = JSON.stringify([AGGREGATION_VERSION, deps.rawDays, deps.aggregateDays])

	/** Finishes what drop notes say runs left: every row of a day but its marker's generation. */
	const sweepDrops = async (going: () => boolean): Promise<number> => {
		let deleted = 0
		for (const note of await state.drops(DROPS_PER_RUN)) {
			if (!going()) {
				break
			}
			const [marker] = await state.markers(note.scope, note.day, note.day)
			if (!marker) {
				// Without a marker no run reads or writes the day: whatever rows it holds are dead.
				deleted += await store.sweepGenerations(note, '')
				await state.clearDrop(note)
				continue
			}
			const owner = deps.owner()
			const lease = dayKey(note.scope, note.day)
			if (!(await state.claim(lease, owner, DAY_LEASE_MS))) {
				continue
			}
			try {
				const [held] = await state.markers(note.scope, note.day, note.day)
				if (held?.leaseOwner === owner) {
					deleted += await store.sweepGenerations(held, held.gen ?? '')
					await state.clearDrop(note)
				}
			} finally {
				await state.release(lease, owner).catch(() => false)
			}
		}
		return deleted
	}

	/** A scope's markers from its oldest hit on, closed days with hits found and given one. */
	const discover = async (target: { scope: string; tz: string }, run: Run): Promise<ScopeState> => {
		const { scope, tz } = target
		const { now, report, going } = run
		const today = todayIn(now, tz)
		const lastClosed = lastClosedDay(now, tz)
		const horizon = rawFloorDay(today, deps.rawDays ?? DEFAULT_RAW_DAYS)
		const oldest = await store.oldestHit(scope)
		const prunedBefore = await state.prunedBefore(scope)
		// Before the prune cut only order tombstones are left: no day there is ever counted again.
		const kept =
			oldest === null || prunedBefore === null || oldest >= prunedBefore ? oldest : prunedBefore
		const oldestDay = kept === null ? null : calendarDayOf(kept, tz)
		const from =
			deps.rawDays === null || oldestDay === null ? horizon : Math.min(horizon, oldestDay)
		const before = addCalendarDays(from, -1)
		let markers = await state.markers(scope, before, today)
		const known = byDay(markers)
		const startOf = (day: CalendarDay): Date =>
			windowOf(day, { tz, markers: known, prunedBefore }).start
		const unknown =
			oldest === null || from > lastClosed
				? []
				: datesOf(from, lastClosed).filter((day) => !known.has(day))
		let discovered = true
		const hits: CalendarDay[] = []
		const none: CalendarDay[] = []
		for (const dates of runsOf(unknown)) {
			if (!going()) {
				discovered = false
				break
			}
			const found = await deps.probe({ ...target, startOf }, dates)
			hits.push(...found.hits)
			none.push(...found.none)
		}
		if (hits.length > 0) {
			await state.ensureMarkers(hits.map((day) => ({ scope, day, tz })))
			report.discovered += hits.length
		}
		if (unknown.length > 0) {
			markers = await state.markers(scope, before, today)
		}
		const sealed = none
			.filter((day) => day >= horizon && isSealed(day, tz, now))
			.sort((a, b) => b - a)
		return {
			scope,
			tz,
			today,
			lastClosed,
			from,
			prunedBefore,
			markers,
			discovered,
			empty: sealed.slice(0, EMPTY_PER_RUN),
		}
	}

	/**
	 * A fixed day marked dirty can never be counted again, and would take a pending slot on every
	 * run: it goes back to the status its count left, `empty` for a day that wrote no rows.
	 */
	const settleFixed = async (marker: DayMarker): Promise<void> => {
		const owner = deps.owner()
		const lease = dayKey(marker.scope, marker.day)
		if (!(await state.claim(lease, owner, DAY_LEASE_MS))) {
			return
		}
		const [held] = await state.markers(marker.scope, marker.day, marker.day)
		const prunedBefore = await state.prunedBefore(marker.scope)
		const settled =
			held?.leaseOwner === owner &&
			held.status === 'dirty' &&
			isFixed(held, prunedBefore) &&
			(await state.complete({ ...held, status: held.gen === null ? 'empty' : 'final' }, owner))
		if (!settled) {
			await state.release(lease, owner).catch(() => false)
		}
	}

	/** Whether a run bounded by `stallMs` leaves counting `target` to another run, saying so. */
	const deferred = async (
		target: DayTarget,
		stallMs: number | undefined,
		report: MaintainReport
	): Promise<boolean> => {
		if (stallMs === undefined || (await deps.fits(target, stallMs))) {
			return false
		}
		report.deferred += 1
		return true
	}

	/** Counts one due day; false when it is left for a later run: deferred, failed or busy. */
	const count = async (day: DueDay, run: Run): Promise<boolean> => {
		const { report } = run
		run.attempted.add(dayKey(day.scope, day.day))
		const startOf = (): Date => day.start ?? calendarDayStart(day.day, day.tz)
		try {
			if (day.via === 'probe') {
				const found = await deps.probe({ ...day, startOf }, [day.day, day.day])
				if (found.hits.length === 0) {
					report.empty += await deps.markEmpty({ ...day, startOf }, [day.day], () => false)
					return true
				}
			}
			if (await deferred(day, run.stallMs, report)) {
				return false
			}
			const counted = await deps.aggregate(day)
			if (counted.outcome === 'completed') {
				report.aggregated += 1
				return true
			}
			if (counted.outcome === 'failed') {
				report.markedFailed += 1
				deps.warn(
					`analytics: maintenance gave up counting ${day.day} of scope "${day.scope}" after ${MAX_COUNT_ATTEMPTS} attempts; its raw hits are pruned as they age, and reads say the day failed`
				)
				return true
			}
			return false
		} catch (err) {
			report.failed += 1
			deps.warn(
				`analytics: maintenance could not count ${day.day} of scope "${day.scope}": ${String(err)}`
			)
			return false
		}
	}

	/**
	 * Every day the state rows hold due (dirty, closed but never counted whole, provisional and
	 * sealed), oldest first across scopes, page by page, until the step's share of the budget.
	 */
	const countPending = async (run: Run): Promise<void> => {
		const until = deps.clock() + Math.floor(run.budgetMs * PENDING_SHARE)
		const going = (): boolean => run.going() && deps.clock() < until
		let after: Pick<DayMarker, 'scope' | 'day'> | undefined
		while (going()) {
			const page = await state.pending(run.now, PENDING_LIMIT, after)
			const pruned = await state.prunedBeforeIn([...new Set(page.map((each) => each.scope))])
			for (const marker of page) {
				if (!going()) {
					return
				}
				after = { scope: marker.scope, day: marker.day }
				if (run.attempted.has(dayKey(marker.scope, marker.day))) {
					continue
				}
				const prunedBefore = pruned.get(marker.scope) ?? null
				if (marker.status === 'dirty' && isFixed(marker, prunedBefore)) {
					await settleFixed(marker)
					continue
				}
				const tz = await run.zoneOf(marker.scope)
				if (tz === null) {
					continue
				}
				const before = addCalendarDays(marker.day, -1)
				const previous = await state.markers(marker.scope, before, before)
				const [due] = dueDays({
					markers: [...previous, marker],
					tz,
					now: run.now,
					lastClosed: lastClosedDay(run.now, tz),
					prunedBefore,
				}).filter((each) => each.day === marker.day)
				if (due) {
					await count(due, run)
				}
			}
			if (page.length < PENDING_LIMIT) {
				return
			}
		}
	}

	/** Today's snapshot retaken for a scope whose today is too busy to read live; false when left. */
	const snapshotToday = async (
		each: Pick<ScopeState, 'scope' | 'tz' | 'today' | 'prunedBefore'>,
		run: Run
	): Promise<boolean> => {
		const { now, report } = run
		const markers = await state.markers(each.scope, addCalendarDays(each.today, -1), each.today)
		const today = markers.find((marker) => marker.day === each.today)
		const window = windowOf(each.today, { ...each, markers: byDay(markers) })
		const target: DayTarget = {
			scope: each.scope,
			day: each.today,
			tz: each.tz,
			start: window.start,
		}
		if (
			!(await deps.today.busy(target, window)) ||
			snapshotState(today, { tz: each.tz, window, now, maxAgeMs: deps.today.maxAgeMs }) === 'fresh'
		) {
			return true
		}
		if (await deferred(target, run.stallMs, report)) {
			return false
		}
		const taken = await deps.snapshot(target).catch((err: unknown): DayRun => {
			deps.warn(
				`analytics: maintenance could not snapshot today of scope "${each.scope}": ${String(err)}`
			)
			return { outcome: 'lost' }
		})
		if (taken.outcome === 'completed') {
			report.snapshots += 1
		}
		return taken.outcome === 'completed'
	}

	/**
	 * Deletes a scope's raw hits before `cut` (orders kept as tombstones) from where the last prune
	 * stopped, then the tombstones before `ordersBefore`; true once both are done.
	 */
	const pruneBefore = async (
		scope: string,
		cuts: { cut: Date; ordersBefore: Date | null; recorded: Date | null },
		run: Run
	): Promise<boolean> => {
		const { cut, ordersBefore, recorded } = cuts
		if (recorded === null || recorded < cut) {
			await state.recordPruned(scope, cut)
		}
		const done = dateOf(await state.cursor(pruneCursor(scope)))
		let finished = done !== null && done >= cut
		// A hit can still land a little below the last cut after it was made: an engagement is filed
		// up to a day before it arrives.
		const from = done === null ? null : new Date(done.getTime() - LATE_HIT_REACH_MS)
		while (!finished && run.going()) {
			const pruned = await store.pruneHits({
				scope,
				before: cut,
				...(from === null ? {} : { from }),
				limit: PRUNE_CHUNK,
			})
			run.report.prunedHits += pruned
			finished = pruned < PRUNE_CHUNK
		}
		if (finished && (done === null || done < cut)) {
			await state.setCursor(pruneCursor(scope), cut.toISOString())
		}
		if (ordersBefore === null) {
			return finished
		}
		while (run.going()) {
			const expired = await store.expireOrders({ scope, before: ordersBefore, limit: PRUNE_CHUNK })
			run.report.expiredOrders += expired
			if (expired < PRUNE_CHUNK) {
				return finished
			}
		}
		return false
	}

	/**
	 * One scope's raw hits and, with `aggregateDays`, its daily totals chunk by chunk, their markers
	 * once every row of those days is gone. True once it is done.
	 */
	const prune = async (each: ScopeState, run: Run, fresh: boolean): Promise<boolean> => {
		const { now, report, going } = run
		const markers = fresh
			? each.markers
			: await state.markers(each.scope, addCalendarDays(each.from, -1), each.today)
		const cut = rawPruneCut({
			now,
			tz: each.tz,
			rawDays: deps.rawDays,
			markers,
			prunedBefore: each.prunedBefore,
		})
		const first = aggregatePruneDay({
			today: each.today,
			aggregateDays: deps.aggregateDays,
			markers,
			prunedBefore: each.prunedBefore,
		})
		if (cut !== null) {
			const ordersBefore = first === null ? null : calendarDayStart(first, each.tz)
			const cuts = { cut, ordersBefore, recorded: each.prunedBefore }
			if (!going() || !(await pruneBefore(each.scope, cuts, run))) {
				return false
			}
		}
		while (first !== null) {
			if (!going()) {
				return false
			}
			const deleted = await store.pruneAggregates({
				scope: each.scope,
				beforeDay: first,
				limit: PRUNE_CHUNK,
			})
			report.prunedAggregates += deleted
			if (deleted < PRUNE_CHUNK) {
				report.prunedMarkers += await state.dropMarkers(each.scope, first)
				return true
			}
		}
		return true
	}

	/**
	 * A scope whose zone never resolved is never counted, but its raw hits still age out: cut where
	 * no zone's floor comes before, and before every day still to be counted.
	 */
	const pruneUnzoned = async (scope: string, run: Run): Promise<void> => {
		deps.warn(
			`analytics: the reporting timezone of scope "${scope}" has never resolved, so none of its days are counted; its raw hits are still deleted once they are older than retention.rawDays in every zone`
		)
		let cut = zoneFreeRawFloor(run.now, deps.rawDays)
		const oldest = await store.oldestHit(scope)
		if (cut === null || oldest === null || oldest >= cut) {
			return
		}
		const prunedBefore = await state.prunedBefore(scope)
		const markers = await state.markers(
			scope,
			addCalendarDays(calendarDayOf(oldest, WESTMOST_ZONE), -1),
			todayIn(run.now, EASTMOST_ZONE)
		)
		for (const marker of markers) {
			if (NOT_FINAL.has(marker.status) && !isFixed(marker, prunedBefore)) {
				const start = markerStart(marker)
				if (start < cut) {
					cut = start
				}
			}
		}
		await pruneBefore(
			scope,
			{ cut, ordersBefore: zoneFreeRawFloor(run.now, deps.aggregateDays), recorded: prunedBefore },
			run
		)
	}

	/**
	 * The backstop for ingest's own check: every order record stored since `since` has its twin's
	 * closed day counted again where needed, paged by time then id so none sharing a moment is lost.
	 */
	const sweepOrders = async (scope: string, since: Date, run: Run): Promise<boolean> => {
		let after: OrderKey | undefined
		while (run.going()) {
			const orders = await store.ordersIn({
				scope,
				start: since,
				end: run.now,
				limit: ORDER_SWEEP_CHUNK,
				...(after === undefined ? {} : { after }),
			})
			for (const order of orders) {
				await deps.orderStored(scope, order.id)
				run.report.sweptOrders += 1
			}
			after = orders.at(-1)
			if (orders.length < ORDER_SWEEP_CHUNK || after === undefined) {
				return true
			}
		}
		return false
	}

	/**
	 * Whether a scope's last whole pass saw what it would see now but its new hits: the same zone
	 * and settings, the same local today and last closed day, so no day closed or aged out since.
	 */
	const sameDay = (stamp: PassStamp & { at: Date }, tz: string, now: Date): boolean =>
		stamp.tz === tz &&
		stamp.settings === settings &&
		todayIn(stamp.at, tz) === todayIn(now, tz) &&
		lastClosedDay(stamp.at, tz) === lastClosedDay(now, tz)

	/** Whether a hit was stored for a scope from shortly before `since` on. */
	const hitSince = (scope: string, since: Date, now: Date): Promise<boolean> =>
		store.hasHits({
			scope,
			start: new Date(since.getTime() - ORDER_SWEEP_REACH_MS),
			end: new Date(now.getTime() + FUTURE_REACH_MS),
		})

	/** Where a scope's order sweep starts: shortly before the last one that finished. */
	const sweptSince = (stamp: PassStamp | null, now: Date): Date =>
		new Date((stamp?.swept ?? stamp?.at ?? now).getTime() - ORDER_SWEEP_REACH_MS)

	/**
	 * A full pass: closed days found, orders swept, due days counted within the scope's share of the
	 * budget, days without hits marked, today snapshotted, old rows pruned. Answers what finished.
	 */
	const fullPass = async (
		target: { scope: string; tz: string; stamp: PassStamp | null },
		run: Run
	): Promise<{ whole: boolean; swept: boolean }> => {
		const { scope } = target
		const each = await discover(target, run)
		const before = run.report.sweptOrders
		const swept = await sweepOrders(scope, sweptSince(target.stamp, run.now), run)
		let whole = swept && each.discovered
		let fresh = run.report.sweptOrders === before
		const due = dueDays({
			...each,
			markers: fresh
				? each.markers
				: await state.markers(scope, addCalendarDays(each.from, -1), each.today),
			now: run.now,
		})
		const until = deps.clock() + Math.max(1, Math.floor(run.budgetMs * SCOPE_COUNT_SHARE))
		for (const day of due) {
			// Past its share the rest wait for the pending step, and the scope's pruning still runs.
			if (!run.going() || deps.clock() >= until) {
				whole = false
				break
			}
			if (!run.attempted.has(dayKey(day.scope, day.day))) {
				fresh = false
				whole = (await count(day, run)) && whole
			}
		}
		if (!run.going()) {
			return { whole: false, swept }
		}
		const markers = byDay(each.markers)
		try {
			const marked = await deps.markEmpty(
				{ ...each, startOf: (day) => windowOf(day, { ...each, markers }).start },
				each.empty,
				() => !run.going()
			)
			run.report.empty += marked
			fresh = fresh && marked === 0
		} catch (err) {
			whole = false
			deps.warn(
				`analytics: maintenance could not mark the days without hits of scope "${scope}" empty: ${String(err)}`
			)
		}
		if (!run.going()) {
			return { whole: false, swept }
		}
		whole = (await snapshotToday(each, run)) && whole
		if (!run.going()) {
			return { whole: false, swept }
		}
		if (each.discovered) {
			whole = (await prune(each, run, fresh)) && whole
		}
		return { whole: whole && run.going(), swept }
	}

	/**
	 * One scope's turn: passed over with nothing new since its last whole pass, only its orders and
	 * today swept on the same day, else a full pass; stamped with what finished.
	 */
	const passScope = async (scope: string, run: Run): Promise<void> => {
		const tz = await run.zoneOf(scope)
		if (tz === null) {
			await pruneUnzoned(scope, run)
			return
		}
		const stamp = stampOf(await state.cursor(passCursor(scope)))
		const stamped = (done: { whole: boolean; swept: boolean }): Promise<void> =>
			state.setCursor(
				passCursor(scope),
				stampText({
					at: done.whole ? run.now : null,
					swept: done.swept ? run.now : (stamp?.swept ?? null),
					tz,
					settings,
				})
			)
		const at = stamp?.at ?? null
		if (stamp !== null && at !== null && sameDay({ ...stamp, at }, tz, run.now)) {
			if (!(await hitSince(scope, at, run.now))) {
				run.report.scopesSkipped += 1
				return
			}
			run.report.scopesPassed += 1
			const swept = await sweepOrders(scope, sweptSince(stamp, run.now), run)
			const prunedBefore = await state.prunedBefore(scope)
			const today = { scope, tz, today: todayIn(run.now, tz), prunedBefore }
			const whole = swept && run.going() && (await snapshotToday(today, run)) && run.going()
			await stamped({ whole, swept })
			return
		}
		run.report.scopesPassed += 1
		await stamped(await fullPass({ scope, tz, stamp }, run))
	}

	/** Each scope in turn from the one after where the last run stopped, while the budget lasts. */
	const rotate = async (run: Run): Promise<void> => {
		const scopes = await deps.scopes()
		const last = await state.cursor(ROTATION_CURSOR)
		const next = last === null ? 0 : scopes.findIndex((scope) => compareCodePoints(scope, last) > 0)
		const start = next < 0 ? 0 : next
		let reached = last
		for (const scope of [...scopes.slice(start), ...scopes.slice(0, start)]) {
			if (!run.going()) {
				break
			}
			reached = scope
			await passScope(scope, run)
		}
		if (reached !== null && reached !== last) {
			await state.setCursor(ROTATION_CURSOR, reached)
		}
	}

	const steps = async (input: MaintainInput, report: MaintainReport, going: () => boolean) => {
		const now = deps.now()
		report.sweptSalts = await state.sweep(now)
		report.sweptRows = await sweepDrops(going)
		if (input.rebuild && deps.open()) {
			report.rebuild = await deps.rebuild(input.rebuild, input.req)
		}
		const zones = new Map<string, Promise<string | null>>()
		const run: Run = {
			now,
			report,
			going,
			stallMs: input.stallMs,
			budgetMs: input.budgetMs,
			attempted: new Set(),
			zoneOf: (scope) => {
				const known = zones.get(scope)
				if (known) {
					return known
				}
				const resolved = deps.zoneOf(scope, input.req)
				zones.set(scope, resolved)
				return resolved
			},
		}
		await countPending(run)
		if (!going()) {
			return
		}
		await rotate(run)
		// The days an order swept just now marked dirty are counted in this run.
		if (report.sweptOrders > 0 && going()) {
			await countPending(run)
		}
		report.finished = going()
	}

	return {
		async run(input: MaintainInput): Promise<MaintainReport> {
			if (!Number.isInteger(input.budgetMs) || input.budgetMs < 0) {
				throw new Error(
					`analytics: a maintenance run needs a budget of whole milliseconds, got ${input.budgetMs}`
				)
			}
			const report = emptyReport()
			if (!deps.open()) {
				return report
			}
			const deadline = deps.clock() + input.budgetMs
			const owner = deps.owner()
			const ttlMs = input.budgetMs + DAY_LEASE_MS
			// Renewed while the run works, so a step that outlasts its budget never lets a second run
			// in, and the job's stuck guard sees the run as alive.
			const outcome = await underLease(
				{
					lease: {
						claim: () => state.claim(MAINTAIN_LEASE, owner, ttlMs),
						release: async () => {
							await state.release(MAINTAIN_LEASE, owner)
						},
					},
					ttlMs,
					warn: deps.warn,
				},
				(hold) => steps(input, report, () => deps.open() && !hold.lost() && deps.clock() < deadline)
			)
			report.ran = outcome.ran
			if (input.heartbeat === true) {
				await state.beat(MAINTAIN_TASK_SLUG)
			}
			return report
		},
	}
}
