import { describe, expect, it } from 'vitest'
import { AGGREGATION_VERSION } from '../store/aggregate'
import type { DayMarker } from '../store/types'
import {
	createZoneBook,
	daySpan,
	fileDayWithin,
	hourStarts,
	isClosed,
	isFixed,
	isSealed,
	lastClosedDay,
	localDay,
	localDaysOf,
	markerStart,
	rawFloor,
	rawFloorDay,
	todayIn,
	windowOf,
	zoneFreeRawFloor,
} from './days'
import { MAX_REMEMBERED_SCOPES } from './recent'

const HOUR = 3_600_000
const at = (iso: string): Date => new Date(iso)
const hours = (day: { start: Date; end: Date }): number =>
	(day.end.getTime() - day.start.getTime()) / HOUR

describe('local days across daylight saving changes', () => {
	it('gives New York a 23-hour day in spring and a 25-hour day in autumn', () => {
		const spring = localDay(20260308, 'America/New_York')
		expect(spring.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
		expect(spring.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
		expect(hours(spring)).toBe(23)
		const autumn = localDay(20261101, 'America/New_York')
		expect(autumn.start.toISOString()).toBe('2026-11-01T04:00:00.000Z')
		expect(autumn.end.toISOString()).toBe('2026-11-02T05:00:00.000Z')
		expect(hours(autumn)).toBe(25)
	})

	it('gives Berlin a 23-hour day in spring and a 25-hour day in autumn', () => {
		const spring = localDay(20260329, 'Europe/Berlin')
		expect(spring.start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
		expect(hours(spring)).toBe(23)
		const autumn = localDay(20261025, 'Europe/Berlin')
		expect(autumn.start.toISOString()).toBe('2026-10-24T22:00:00.000Z')
		expect(autumn.end.toISOString()).toBe('2026-10-25T23:00:00.000Z')
		expect(hours(autumn)).toBe(25)
	})

	it('lists every day a range touches, end to start, never skipping or repeating one', () => {
		const days = localDaysOf(
			at('2026-03-07T05:00:00.000Z'),
			at('2026-03-10T04:00:00.000Z'),
			'America/New_York'
		)
		expect(days.map((day) => day.day)).toEqual([20260307, 20260308, 20260309])
		expect(days.map(hours)).toEqual([24, 23, 24])
		for (let i = 1; i < days.length; i++) {
			expect(days[i]?.start).toEqual(days[i - 1]?.end)
		}
		const berlin = localDaysOf(
			at('2026-10-24T00:00:00.000Z'),
			at('2026-10-26T12:00:00.000Z'),
			'Europe/Berlin'
		)
		expect(berlin.map((day) => [day.day, hours(day)])).toEqual([
			[20261024, 24],
			[20261025, 25],
			[20261026, 24],
		])
	})

	it('reads the end of a range as exclusive, and an empty range as no day at all', () => {
		expect(daySpan(at('2026-10-05T00:00:00.000Z'), at('2026-10-07T00:00:00.000Z'), 'UTC')).toEqual({
			first: 20261005,
			last: 20261006,
		})
		expect(daySpan(at('2026-10-05T00:00:00.000Z'), at('2026-10-05T00:00:00.000Z'), 'UTC')).toBe(
			null
		)
		expect(
			localDaysOf(at('2026-10-06T00:00:00.000Z'), at('2026-10-05T00:00:00.000Z'), 'UTC')
		).toEqual([])
	})
})

describe('which days are closed', () => {
	const day = localDay(20261006, 'America/New_York')

	it('closes a day once its late beacons had a quarter hour, in its own zone', () => {
		expect(isClosed(day, at('2026-10-07T04:14:59.999Z'))).toBe(false)
		expect(isClosed(day, at('2026-10-07T04:15:00.000Z'))).toBe(true)
		expect(todayIn(at('2026-10-07T03:59:59.999Z'), 'America/New_York')).toBe(20261006)
		expect(todayIn(at('2026-10-07T04:00:00.000Z'), 'America/New_York')).toBe(20261007)
	})

	it('seals a day a day and a quarter hour after it ends, when no engagement can still reach it', () => {
		expect(isSealed(20261006, 'America/New_York', at('2026-10-08T04:14:59.999Z'))).toBe(false)
		expect(isSealed(20261006, 'America/New_York', at('2026-10-08T04:15:00.000Z'))).toBe(true)
	})

	it('names the latest closed date: yesterday, or the day before in the first quarter hour', () => {
		expect(lastClosedDay(at('2026-10-07T04:14:59.999Z'), 'America/New_York')).toBe(20261005)
		expect(lastClosedDay(at('2026-10-07T04:15:00.000Z'), 'America/New_York')).toBe(20261006)
		expect(lastClosedDay(at('2026-10-06T18:45:00.000Z'), 'Asia/Kolkata')).toBe(20261006)
	})

	it('reads raw hits from the start of the oldest of the last raw days, today counted', () => {
		const now = at('2026-10-07T10:00:00.000Z')
		expect(rawFloorDay(20261007, 90)).toBe(20260710)
		expect(rawFloor(now, 'Europe/Berlin', 90)?.toISOString()).toBe('2026-07-09T22:00:00.000Z')
		expect(rawFloor(now, 'UTC', 1)?.toISOString()).toBe('2026-10-07T00:00:00.000Z')
		expect(rawFloor(now, 'UTC', null)).toBe(null)
	})
})

describe('hour starts', () => {
	it('counts 25 local hours on the New York autumn day and 23 on the spring one', () => {
		const autumn = localDay(20261101, 'America/New_York')
		const spring = localDay(20260308, 'America/New_York')
		expect(hourStarts(autumn.start, autumn.end, 'America/New_York')).toHaveLength(25)
		expect(hourStarts(spring.start, spring.end, 'America/New_York')).toHaveLength(23)
	})

	it('starts each hour on the zone own boundary, half past in Kolkata', () => {
		const starts = hourStarts(
			at('2026-10-06T10:10:00.000Z'),
			at('2026-10-06T12:00:00.000Z'),
			'Asia/Kolkata'
		)
		expect(starts.map((start) => start.toISOString())).toEqual([
			'2026-10-06T09:30:00.000Z',
			'2026-10-06T10:30:00.000Z',
			'2026-10-06T11:30:00.000Z',
		])
	})
})

describe('scope zones of a read', () => {
	it('cuts the same instants into different dates once a scope zone changes', () => {
		const start = at('2026-10-06T02:00:00.000Z')
		const end = at('2026-10-07T02:00:00.000Z')
		expect(localDaysOf(start, end, 'UTC').map((day) => day.day)).toEqual([20261006, 20261007])
		expect(localDaysOf(start, end, 'America/New_York').map((day) => day.day)).toEqual([
			20261005, 20261006,
		])
	})

	it('asks each scope once per read, and a later read sees a zone the scope changed to', async () => {
		const asked: string[] = []
		let zone = 'Europe/Berlin'
		const book = createZoneBook(
			(scope) => {
				asked.push(scope)
				return zone
			},
			() => undefined
		)
		const first = book.forRead('UTC')
		const zoneOf = async (zones: { of(scope: string): Promise<{ tz: string }> }, scope: string) =>
			(await zones.of(scope)).tz
		expect(await Promise.all([zoneOf(first, 'a'), zoneOf(first, 'a'), zoneOf(first, 'b')])).toEqual(
			['Europe/Berlin', 'Europe/Berlin', 'Europe/Berlin']
		)
		expect(asked).toEqual(['a', 'b'])
		zone = 'America/New_York'
		expect(await zoneOf(first, 'a')).toBe('Europe/Berlin')
		expect(await zoneOf(book.forRead('UTC'), 'a')).toBe('America/New_York')
		expect(asked).toEqual(['a', 'b', 'a'])
	})

	it('keeps a scope last good zone when the source fails, warning once, never falling to UTC', async () => {
		const warnings: string[] = []
		let answer: () => string = () => 'Asia/Tokyo'
		const book = createZoneBook(
			() => answer(),
			(message) => warnings.push(message)
		)
		expect(await book.forRead().of('a')).toEqual({ tz: 'Asia/Tokyo', standIn: false })
		answer = () => {
			throw new Error('resolver down')
		}
		expect(await book.forRead('Europe/Berlin').of('a')).toEqual({
			tz: 'Asia/Tokyo',
			standIn: false,
		})
		answer = () => 'Mars/Olympus'
		expect((await book.forRead('Europe/Berlin').of('a')).tz).toBe('Asia/Tokyo')
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toMatch(/scope "a" could not be resolved, so it is read in Asia\/Tokyo/)
	})

	it('falls back to the zone a scope’s newest counted day was counted in, in a fresh process', async () => {
		const recorded: string[] = []
		const book = createZoneBook(
			() => {
				throw new Error('resolver down')
			},
			() => undefined,
			async (scope) => {
				recorded.push(scope)
				return scope === 'counted' ? 'Asia/Tokyo' : null
			}
		)
		expect(await book.strict('counted')).toBe('Asia/Tokyo')
		expect(await book.forRead().of('counted')).toEqual({ tz: 'Asia/Tokyo', standIn: false })
		expect(await book.strict('never')).toBeNull()
		expect(recorded).toEqual(['counted', 'never'])
	})

	it('resolves a scope strictly for counting: its last good zone on failure, else none at all', async () => {
		const warnings: string[] = []
		const asked: unknown[] = []
		let answer: () => string = () => 'Asia/Tokyo'
		const book = createZoneBook(
			(_scope, req) => {
				asked.push(req)
				return answer()
			},
			(message) => warnings.push(message)
		)
		const job = { payload: {} }
		expect(await book.strict('a', job as never)).toBe('Asia/Tokyo')
		expect(asked).toEqual([job])
		answer = () => {
			throw new Error('resolver down')
		}
		expect(await book.strict('a')).toBe('Asia/Tokyo')
		expect(await book.strict('fresh')).toBeNull()
		expect(warnings).toHaveLength(2)
		expect(warnings[1]).toMatch(/scope "fresh" could not be resolved, so its days are not counted/)
		expect(await createZoneBook(undefined, () => undefined).strict('x')).toBe('UTC')
	})

	it('warns again about a never-resolved scope once it is past the scopes it remembers', async () => {
		const warnings: string[] = []
		const book = createZoneBook(
			() => {
				throw new Error('no zone')
			},
			(message) => warnings.push(message)
		)
		for (let i = 0; i <= MAX_REMEMBERED_SCOPES; i++) {
			await book.strict(`s${i}`)
		}
		await book.strict('s0')
		expect(warnings).toHaveLength(MAX_REMEMBERED_SCOPES + 2)
	})

	it('reads a scope with no good zone ever in UTC, as a stand-in, whatever zone the read names', async () => {
		const book = createZoneBook(
			() => {
				throw new Error('no zone')
			},
			() => undefined
		)
		expect(await book.forRead('Europe/Berlin').of('fresh')).toEqual({ tz: 'UTC', standIn: true })
		expect(await book.forRead('Nowhere/Land').of('fresh')).toEqual({ tz: 'UTC', standIn: true })
		expect(book.forRead('Nowhere/Land').named).toBe('UTC')
		expect(
			await createZoneBook(undefined, () => undefined)
				.forRead('Asia/Kolkata')
				.of('x')
		).toEqual({ tz: 'Asia/Kolkata', standIn: false })
	})
})

const counted = (over: Partial<DayMarker>): DayMarker => ({
	scope: '',
	day: 20261004,
	tz: 'UTC',
	start: null,
	status: 'final',
	version: AGGREGATION_VERSION,
	gen: 'G',
	hits: 2,
	leaseOwner: null,
	leaseUntil: null,
	finalAfter: null,
	aggregatedAt: at('2026-10-06T00:00:00.000Z'),
	...over,
})

describe('windows across a zone change', () => {
	it('fixes a counted day whose count started before the raw hits were cut, and no other', () => {
		const cut = at('2026-10-05T00:00:00.000Z')
		expect(isFixed(counted({}), cut)).toBe(true)
		expect(isFixed(counted({ day: 20261005 }), cut)).toBe(false)
		expect(isFixed(counted({ status: 'empty', gen: null }), cut)).toBe(true)
		expect(isFixed(counted({ status: 'open', gen: null, aggregatedAt: null }), cut)).toBe(false)
		expect(isFixed(counted({}), null)).toBe(false)
		expect(isFixed(undefined, cut)).toBe(false)
	})

	it('starts the day after a fixed one where its count ended, east and west of it', () => {
		const cut = at('2026-10-05T00:00:00.000Z')
		const before = (marker: DayMarker) => new Map([[marker.day, marker]])
		const east = windowOf(20261005, {
			tz: 'Asia/Tokyo',
			markers: before(counted({})),
			prunedBefore: cut,
		})
		expect([east.start.toISOString(), east.end.toISOString()]).toEqual([
			'2026-10-05T00:00:00.000Z',
			'2026-10-05T15:00:00.000Z',
		])
		const west = windowOf(20261005, {
			tz: 'UTC',
			markers: before(counted({ tz: 'Asia/Tokyo' })),
			prunedBefore: at('2026-10-04T15:00:00.000Z'),
		})
		expect([west.start.toISOString(), west.end.toISOString()]).toEqual([
			'2026-10-04T15:00:00.000Z',
			'2026-10-06T00:00:00.000Z',
		])
		expect(
			windowOf(20261005, { tz: 'Asia/Tokyo', markers: before(counted({})), prunedBefore: null })
		).toEqual(localDay(20261005, 'Asia/Tokyo'))
		expect(
			windowOf(20261005, { tz: 'UTC', markers: before(counted({})), prunedBefore: cut })
		).toEqual(localDay(20261005, 'UTC'))
	})

	it('reads a recorded window start back, else the day’s own start in its zone', () => {
		const seam = at('2026-10-04T15:00:00.000Z')
		expect(markerStart(counted({ start: seam }))).toEqual(seam)
		expect(markerStart(counted({ tz: 'Asia/Tokyo' })).toISOString()).toBe(
			'2026-10-03T15:00:00.000Z'
		)
	})

	it('cuts a scope with no zone where no zone’s own floor comes before', () => {
		for (const iso of [
			'2026-10-07T01:00:00.000Z',
			'2026-10-07T12:00:00.000Z',
			'2026-10-07T23:30:00.000Z',
		]) {
			const now = at(iso)
			const cut = zoneFreeRawFloor(now, 3)
			for (const tz of [
				'Etc/GMT+12',
				'America/New_York',
				'UTC',
				'Asia/Kolkata',
				'Pacific/Kiritimati',
			]) {
				expect(cut?.getTime(), `${iso} ${tz}`).toBeLessThanOrEqual(
					rawFloor(now, tz, 3)?.getTime() ?? 0
				)
			}
		}
		expect(zoneFreeRawFloor(at('2026-10-07T12:00:00.000Z'), null)).toBeNull()
	})
})

describe('fileDayWithin', () => {
	// Oct 1 to Oct 3 in New York, its end exclusive as the engine reads it.
	const range = { start: at('2026-10-01T04:00:00.000Z'), end: at('2026-10-04T04:00:00.000Z') }
	const file = fileDayWithin(range, 'America/New_York')

	it("files a scope's day dated before or after the range under its first or last date", () => {
		expect(file(20260930)).toBe(20261001)
		expect(file(20261004)).toBe(20261003)
		expect(file(20260928)).toBe(20261001)
	})

	it('keeps a day within the range where it is', () => {
		expect([20261001, 20261002, 20261003].map(file)).toEqual([20261001, 20261002, 20261003])
	})

	it('leaves every day alone for an empty range', () => {
		expect(fileDayWithin({ start: range.start, end: range.start }, 'UTC')(20260101)).toBe(20260101)
	})
})
