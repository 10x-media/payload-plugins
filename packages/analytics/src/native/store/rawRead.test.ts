import { describe, expect, it } from 'vitest'
import { InvalidQueryError, UnsupportedFilterError } from '../../core/sourceErrors'
import { emptyParts, type MetricParts } from './parts'
import { MAX_PATTERN_LENGTH } from './pattern'
import {
	compareCodePoints,
	compareRows,
	emptyRow,
	fillsNothing,
	minuteStarts,
	planRawRead,
	ReadTimeoutError,
	rankOf,
	rawFilterMap,
	readRealtime,
} from './rawRead'
import type { RawRead, RawRow } from './types'

const START = new Date('2026-10-06T00:00:00.000Z')
const END = new Date('2026-10-07T00:00:00.000Z')

const read = (more: Partial<RawRead> = {}): RawRead => ({
	start: START,
	end: END,
	filters: [],
	sessions: false,
	timeoutMs: 1000,
	...more,
})

const STORE = { id: 'test', filters: rawFilterMap(['eq', 'contains']) }

const counted = (more: Partial<RawRead>): string[] =>
	[...planRawRead(read(more), STORE).counted].sort()

describe('planRawRead', () => {
	it('counts visits only where it cuts them, and an item never as a page', () => {
		expect(counted({})).toEqual([
			'conversions',
			'durationMs',
			'events',
			'interactions',
			'pageviews',
			'pageviewsWithoutConsent',
			'pageviewsWithoutVisitor',
			'revenue',
			'scrollSamples',
			'scrollSum',
			'visitors',
		])
		expect(counted({ sessions: true })).toContain('bounces')
		expect(counted({ groupBy: 'item' })).toEqual([
			'conversions',
			'events',
			'impressions',
			'interactions',
			'revenue',
			'visitors',
		])
		expect(counted({ item: 'offers:1', sessions: true })).not.toContain('sessions')
	})

	it('cuts visits for a visit dimension in the breakdown or a filter, even without sessions', () => {
		expect(planRawRead(read({ groupBy: 'country' }), STORE).sessionize).toBe(true)
		expect(
			planRawRead(
				read({ filters: [{ dimension: 'source', operator: 'eq', value: 'google' }] }),
				STORE
			).sessionize
		).toBe(true)
		expect(planRawRead(read({ groupBy: 'page' }), STORE).sessionize).toBe(false)
	})

	it('reads from `from` only when it cuts visits', () => {
		const from = new Date('2026-10-05T00:00:00.000Z')
		expect(planRawRead(read({ from, sessions: true }), STORE).from).toBe(from)
		expect(planRawRead(read({ from }), STORE).from).toBe(START)
		expect(() => planRawRead(read({ from: END, sessions: true }), STORE)).toThrow(
			/start or earlier/
		)
	})

	it('counts goal completions or items, never both', () => {
		expect(planRawRead(read({ groupBy: 'goal' }), STORE).axis).toBe('goal')
		expect(planRawRead(read({ item: 'offers:1' }), STORE).axis).toBe('item')
		expect(() =>
			planRawRead(
				read({ groupBy: 'goal', filters: [{ dimension: 'item', operator: 'eq', value: 'x' }] }),
				STORE
			)
		).toThrow(/never both/)
	})

	it('refuses a filter the store does not apply with the error that names it', () => {
		const regex = read({ filters: [{ dimension: 'page', operator: 'matches', value: '^/' }] })
		expect(() => planRawRead(regex, STORE)).toThrow(UnsupportedFilterError)
		expect(() =>
			planRawRead(read({ filters: [{ dimension: 'medium', operator: 'eq', value: 'cpc' }] }), STORE)
		).toThrow(UnsupportedFilterError)
		const everything = { id: 'regex', filters: rawFilterMap(['eq', 'contains', 'matches']) }
		expect(planRawRead(regex, everything).axis).toBe('hit')
	})

	it('refuses a regular expression that is too long or no expression at all', () => {
		const everything = { id: 'regex', filters: rawFilterMap(['matches']) }
		const pattern = (value: string) =>
			read({ filters: [{ dimension: 'page', operator: 'matches', value }] })
		expect(() => planRawRead(pattern('a'.repeat(MAX_PATTERN_LENGTH + 1)), everything)).toThrow(
			/at most/
		)
		expect(() => planRawRead(pattern('(unclosed'), everything)).toThrow(InvalidQueryError)
		expect(() => planRawRead(pattern('[^]1'), everything)).toThrow(/first in a class/)
	})

	it('refuses a breakdown it cannot read and anything malformed', () => {
		expect(() => planRawRead(read({ groupBy: 'campaign' }), STORE)).toThrow(/cannot group/)
		expect(() => planRawRead(read({ buckets: [] }), STORE)).toThrow(/at least one/)
		expect(() => planRawRead(read({ buckets: [END] }), STORE)).toThrow(/at or before/)
		expect(() => planRawRead(read({ buckets: [START, START] }), STORE)).toThrow(/ascend/)
		expect(() => planRawRead(read({ values: ['/'] }), STORE)).toThrow(/need groupBy/)
		expect(() => planRawRead(read({ limit: 0 }), STORE)).toThrow(/limit/)
		expect(() => planRawRead(read({ timeoutMs: 0 }), STORE)).toThrow(/timeout/)
		expect(() => planRawRead(read({ start: new Date(Number.NaN) }), STORE)).toThrow(/valid/)
		const badPart = { part: 'nothing', dir: 'asc' } as unknown as RawRead['order']
		expect(() => planRawRead(read({ order: badPart }), STORE)).toThrow(/orders by its parts/)
	})

	it('fills nothing for an empty exact fill, and answers zeros for an empty total', () => {
		expect(fillsNothing(planRawRead(read({ groupBy: 'page', values: [] }), STORE))).toBe(true)
		const row = emptyRow(planRawRead(read({ sessions: true }), STORE))
		expect(row.value).toBeNull()
		expect(row.parts.sessions).toBe(0)
		expect(row.parts.impressions).toBeNull()
	})
})

const parts = (values: Partial<MetricParts>): MetricParts => ({ ...emptyParts(), ...values })

const row = (value: string | null, values: Partial<MetricParts>, bucket?: number): RawRow => ({
	value,
	...(bucket === undefined ? {} : { bucket }),
	parts: parts(values),
})

describe('ordering', () => {
	it('compares strings by code point, not by UTF-16 unit', () => {
		expect(compareCodePoints('/！', '/🎉')).toBeLessThan(0)
		expect('/！' < '/🎉').toBe(false)
		expect(compareCodePoints('B', 'a')).toBeLessThan(0)
		expect(compareCodePoints('a', 'ab')).toBeLessThan(0)
		expect(compareCodePoints('same', 'same')).toBe(0)
	})

	it('ranks by a part, or by one part over another with nothing to divide by last', () => {
		expect(rankOf(parts({ pageviews: 4 }), { part: 'pageviews', dir: 'desc' })).toBe(4)
		expect(
			rankOf(parts({ durationMs: 30, pageviews: 4 }), {
				part: 'durationMs',
				per: 'pageviews',
				dir: 'asc',
			})
		).toBe(7.5)
		expect(
			rankOf(parts({ durationMs: 30, pageviews: 0 }), {
				part: 'durationMs',
				per: 'pageviews',
				dir: 'asc',
			})
		).toBeNull()
		const timed = { part: 'durationMs', per: 'pageviews', less: 'pageviewsWithoutVisitor' } as const
		expect(
			rankOf(parts({ durationMs: 30, pageviews: 5, pageviewsWithoutVisitor: 2 }), {
				...timed,
				dir: 'asc',
			})
		).toBe(10)
		expect(rankOf(parts({ durationMs: 30, pageviews: 3 }), { ...timed, dir: 'asc' })).toBe(10)
		expect(
			rankOf(parts({ durationMs: 0, pageviews: 2, pageviewsWithoutVisitor: 2 }), {
				...timed,
				dir: 'asc',
			})
		).toBeNull()
		const rows = [
			row('/none', { bounces: 0, entries: 0 }),
			row('/b', { bounces: 1, entries: 2 }),
			row('/a', { bounces: 1, entries: 2 }),
			row('/c', { bounces: 0, entries: 3 }),
		]
		const ascending = [...rows].sort(compareRows({ part: 'bounces', per: 'entries', dir: 'asc' }))
		expect(ascending.map((entry) => entry.value)).toEqual(['/c', '/a', '/b', '/none'])
		const descending = [...rows].sort(compareRows({ part: 'bounces', per: 'entries', dir: 'desc' }))
		expect(descending.map((entry) => entry.value)).toEqual(['/a', '/b', '/c', '/none'])
	})

	it('orders unranked rows by value, then bucket', () => {
		const rows = [row('/b', {}, 1), row('/a', {}, 2), row('/a', {}, 0)]
		expect(rows.sort(compareRows(undefined)).map((entry) => [entry.value, entry.bucket])).toEqual([
			['/a', 0],
			['/a', 2],
			['/b', 1],
		])
	})
})

describe('realtime', () => {
	it('starts a minute at or before the window and steps through it', () => {
		expect(
			minuteStarts(new Date('2026-10-06T10:00:30.000Z'), new Date('2026-10-06T10:02:00.000Z'))
		).toEqual([new Date('2026-10-06T10:00:00.000Z'), new Date('2026-10-06T10:01:00.000Z')])
		expect(minuteStarts(START, START)).toEqual([START])
	})

	it('answers out of four raw reads: totals, minutes, pages and sources ranked by visitors', async () => {
		const reads: RawRead[] = []
		const result = await readRealtime(
			async (raw) => {
				reads.push(raw)
				if (raw.groupBy === 'page') {
					return [row('/a', { visitors: 2, pageviews: 3 })]
				}
				if (raw.groupBy === 'source') {
					return [row('google', { visitors: 1, pageviews: 1 })]
				}
				if (raw.buckets) {
					return [row(null, { visitors: 1, pageviews: 2 }, 1)]
				}
				return [row(null, { visitors: 3, pageviews: 4 })]
			},
			{
				scope: 's',
				start: new Date('2026-10-06T10:00:00.000Z'),
				end: new Date('2026-10-06T10:05:00.000Z'),
				from: START,
				path: '/a',
				top: 3,
				timeoutMs: 500,
			}
		)
		expect(result).toEqual({
			visitors: 3,
			pageviews: 4,
			minutes: [{ minute: new Date('2026-10-06T10:01:00.000Z'), visitors: 1, pageviews: 2 }],
			pages: [{ value: '/a', visitors: 2, pageviews: 3 }],
			sources: [{ value: 'google', visitors: 1, pageviews: 1 }],
		})
		expect(
			reads.map((raw) => [raw.groupBy, raw.order?.part, raw.limit, raw.from, raw.path])
		).toEqual([
			[undefined, undefined, undefined, undefined, '/a'],
			[undefined, undefined, undefined, undefined, '/a'],
			['page', 'visitors', 3, undefined, '/a'],
			['source', 'visitors', 3, START, '/a'],
		])
		expect(reads.every((raw) => raw.scope === 's' && raw.timeoutMs === 500)).toBe(true)
	})

	it('refuses a top that is no whole number, or a part it does not answer', async () => {
		await expect(
			readRealtime(async () => [], { start: START, end: END, top: 0, timeoutMs: 1 })
		).rejects.toThrow(/top/)
		await expect(
			readRealtime(async () => [], {
				start: START,
				end: END,
				parts: ['minutes', 'visits' as 'pages'],
				timeoutMs: 1,
			})
		).rejects.toThrow(/visits/)
	})

	it('reads only the parts asked for: the totals alone for a counter', async () => {
		const reads: RawRead[] = []
		const window = { start: START, end: END, from: START, timeoutMs: 500 }
		const answer = async (raw: RawRead): Promise<RawRow[]> => {
			reads.push(raw)
			return raw.groupBy || raw.buckets ? [] : [row(null, { visitors: 2, pageviews: 5 })]
		}
		expect(await readRealtime(answer, { ...window, parts: [] })).toEqual({
			visitors: 2,
			pageviews: 5,
			minutes: [],
			pages: [],
			sources: [],
		})
		expect(reads).toHaveLength(1)
		await readRealtime(answer, { ...window, parts: ['sources'] })
		expect(reads.slice(1).map((raw) => raw.groupBy)).toEqual([undefined, 'source'])
	})

	it('fails with the error of any part it reads, never answering that part empty', async () => {
		const window = { start: START, end: END, from: START, timeoutMs: 500 }
		const failing =
			(which: (raw: RawRead) => boolean) =>
			async (raw: RawRead): Promise<RawRow[]> => {
				if (which(raw)) {
					throw new ReadTimeoutError('test', 500)
				}
				return raw.groupBy ? [row('/a', { visitors: 1, pageviews: 1 })] : []
			}
		await expect(
			readRealtime(
				failing((raw) => raw.groupBy === 'source'),
				window
			)
		).rejects.toBeInstanceOf(ReadTimeoutError)
		await expect(
			readRealtime(
				failing((raw) => raw.buckets !== undefined),
				{ ...window, parts: ['minutes'] }
			)
		).rejects.toBeInstanceOf(ReadTimeoutError)
		await expect(
			readRealtime(
				failing((raw) => raw.groupBy === undefined && raw.buckets === undefined),
				window
			)
		).rejects.toBeInstanceOf(ReadTimeoutError)
		expect(
			await readRealtime(
				failing((raw) => raw.groupBy === 'source'),
				{ ...window, parts: ['pages'] }
			)
		).toMatchObject({ pages: [{ value: '/a', visitors: 1, pageviews: 1 }] })
	})
})

describe('visitor conditions', () => {
	const plan = (more: Partial<RawRead>) =>
		planRawRead(read(more), { id: 'test', filters: rawFilterMap(['eq', 'contains', 'matches']) })
	const NINE = new Date('2026-10-06T09:00:00.000Z')

	it('keeps everyone for a read that cuts no visits, or cuts them from its own start', () => {
		expect(
			plan({ filters: [{ dimension: 'page', operator: 'eq', value: '/a' }] }).visitors
		).toEqual([])
		expect(plan({ sessions: true }).visitors).toEqual([])
	})

	it('keeps the visitors with a hit passing each filter: a visit dimension looked for from `from`', () => {
		const country = { dimension: 'country', operator: 'eq', value: 'DE' } as const
		const page = { dimension: 'page', operator: 'contains', value: 'blog' } as const
		expect(plan({ start: NINE, from: START, filters: [country, page] }).visitors).toEqual([
			{ start: START, filter: country },
			{ start: NINE, filter: page },
		])
		expect(
			plan({ sessions: true, path: '/a', item: 'offers:1', filters: [country] }).visitors
		).toEqual([
			{ start: START, filter: country },
			{ start: START, filter: { dimension: 'page', operator: 'eq', value: '/a' } },
			{ start: START, filter: { dimension: 'item', operator: 'eq', value: 'offers:1' } },
		])
	})

	it('keeps the visitors active in the window when visits are cut from before it', () => {
		expect(plan({ start: NINE, from: START, sessions: true, groupBy: 'source' }).visitors).toEqual([
			{ start: NINE },
		])
		const country = { dimension: 'country', operator: 'eq', value: 'DE' } as const
		expect(plan({ start: NINE, from: START, filters: [country] }).visitors).toEqual([
			{ start: START, filter: country },
			{ start: NINE },
		])
	})
})
