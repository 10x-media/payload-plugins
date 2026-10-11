import { describe, expect, it } from 'vitest'
import {
	AGGREGATE_KINDS,
	AGGREGATION_VERSION,
	type AggregateRecord,
	answerAggregateRead,
	byRecordId,
	capDay,
	checkDayWindow,
	checkRun,
	completedMarker,
	type DayRow,
	dayGenKey,
	dayRowOf,
	dayWindow,
	foldedDaysOf,
	type GenerationWriter,
	KIND_DIMS,
	KIND_DIMS2,
	kindOf,
	kindsWritten,
	planAggregateRead,
	planFoldRead,
	readStable,
	recordOf,
	seamOf,
	startingAt,
	writeBeside,
} from './aggregate'
import { DEFAULT_CAPS } from './caps'
import { aggregateId } from './ids'
import { memoryStateStore } from './memory/memoryState'
import { emptyParts, type MetricParts } from './parts'
import { DAY_LEASE_MS, dayKey } from './state'
import type { AggregateRead, DayWindow } from './types'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const WINDOW = dayWindow('s', 20261006, 'UTC')

const kind = (dim: string, dim2 = '') => {
	const found = AGGREGATE_KINDS.find((each) => each.dim === dim && each.dim2 === dim2)
	if (!found) {
		throw new Error(`no kind ${dim} ${dim2}`)
	}
	return found
}

const row = (of: ReturnType<typeof kind>, value: string, counts: Partial<MetricParts>): DayRow => ({
	kind: of,
	hostname: 'a.example',
	value,
	value2: '',
	parts: { ...emptyParts(), ...counts },
})

const onB = (day: DayRow): DayRow => ({ ...day, hostname: 'b.example' })

describe('aggregate kinds', () => {
	it('keeps the site row, fifteen visit dimensions, five hit dimensions and four pairs', () => {
		expect(AGGREGATE_KINDS.map((each) => `${each.dim}:${each.dim2}`)).toEqual([
			':',
			'referrer:',
			'source:',
			'channel:',
			'utmSource:',
			'utmMedium:',
			'utmCampaign:',
			'utmContent:',
			'utmTerm:',
			'country:',
			'region:',
			'city:',
			'language:',
			'device:',
			'browser:',
			'os:',
			'page:',
			'event:',
			'currency:',
			'goal:',
			'goal:channel',
			'goal:source',
			'goal:utmCampaign',
			'item:',
			'item:page',
		])
		expect(AGGREGATE_KINDS.map((each) => each.index)).toEqual(AGGREGATE_KINDS.map((_, i) => i))
		expect(KIND_DIMS).toHaveLength(21)
		expect(KIND_DIMS2).toEqual(['', 'channel', 'source', 'utmCampaign', 'page'])
	})

	it('caps every kind but the site row, the goal pairs and item pages under their own caps', () => {
		expect(kind('').cap).toBeNull()
		expect(kind('referrer').cap).toBe('referrer')
		expect(kind('goal', 'source').cap).toBe('goalPairs')
		expect(kind('item', 'page').cap).toBe('itemPages')
	})

	it('counts no visits for items and no item views anywhere else', () => {
		expect([...kind('item').counted].sort()).toEqual(
			['conversions', 'events', 'impressions', 'interactions', 'revenue', 'visitors'].sort()
		)
		expect(kind('page').counted.has('impressions')).toBe(false)
		expect(kind('page').counted.has('sessionMs')).toBe(true)
	})

	it('leaves the item by page rows out when the install keeps no item pages', () => {
		expect(kindsWritten(true)).toHaveLength(25)
		expect(kindsWritten(false).map((each) => `${each.dim}:${each.dim2}`)).not.toContain('item:page')
		expect(kindOf('goal', 'channel')?.index).toBe(20)
		expect(kindOf('page', 'source')).toBeUndefined()
	})

	it('reads a day row out of a store’s answer, its kind’s uncounted parts null', () => {
		const counted = dayRowOf(
			{ kind: kind('item').index, hostname: 'h', value: 'offers:1', value2: '' },
			() => 3
		)
		expect(counted?.parts).toMatchObject({ impressions: 3, pageviews: null, sessions: null })
		expect(dayRowOf({ kind: 99, hostname: 'h', value: '', value2: '' }, () => 1)).toBeUndefined()
	})
})

describe('day windows and runs', () => {
	it('cuts a day at its local midnights, which DST moves', () => {
		const spring = dayWindow('s', 20260329, 'Europe/Berlin')
		expect(spring.start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
		expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000)
		expect(() => checkDayWindow(spring)).not.toThrow()
	})

	it('refuses a window whose instants are not its day in its zone', () => {
		const shifted: DayWindow = { ...WINDOW, end: new Date(WINDOW.end.getTime() + 1) }
		expect(() => checkDayWindow(shifted)).toThrow(/20261006 in UTC runs from/)
		expect(() => checkDayWindow({ ...WINDOW, tz: 'Mars/Olympus' })).toThrow(/IANA/)
		expect(() => checkDayWindow({ ...WINDOW, day: 20260231 })).toThrow(/calendar day/)
	})

	it('takes a seam start near the day’s own, where a fixed day before it ended, and no other', () => {
		const seam = new Date('2026-10-05T15:00:00.000Z')
		const window = startingAt(WINDOW, seam)
		expect(() => checkDayWindow(window)).not.toThrow()
		expect(seamOf(window)).toEqual(seam)
		expect(seamOf(WINDOW)).toBeNull()
		const far = new Date(WINDOW.start.getTime() - 3 * 86_400_000)
		expect(() => checkDayWindow({ ...WINDOW, start: far })).toThrow(/or a seam near it/)
		expect(() => checkDayWindow({ ...WINDOW, start: new Date(WINDOW.end.getTime() + 1) })).toThrow(
			/or a seam near it/
		)
	})

	it('checks a run and fills its caps in from the defaults', () => {
		expect(checkRun({ runId: 'r', caps: DEFAULT_CAPS, status: 'final' })).toEqual({
			caps: DEFAULT_CAPS,
			itemPages: true,
		})
		expect(
			checkRun({
				runId: 'r',
				caps: { ...DEFAULT_CAPS, page: 5 },
				status: 'partial',
				itemPages: false,
			})
		).toMatchObject({ caps: { page: 5 }, itemPages: false })
		expect(() => checkRun({ runId: '', caps: DEFAULT_CAPS, status: 'final' })).toThrow(/lease/)
	})
})

describe('capping and records', () => {
	it('caps each hostname’s rows of a kind on their own, never the site row', () => {
		const rows = [
			row(kind(''), '', { pageviews: 9 }),
			onB(row(kind(''), '', { pageviews: 1 })),
			...['/a', '/b', '/c'].map((path, i) => row(kind('page'), path, { pageviews: 3 - i })),
			onB(row(kind('page'), '/x', { pageviews: 1 })),
		]
		const capped = capDay(rows, { ...DEFAULT_CAPS, page: 1 })
		expect(capped.map((each) => [each.hostname, each.kind.dim, each.value])).toEqual([
			['a.example', '', ''],
			['b.example', '', ''],
			['a.example', 'page', '/a'],
			['a.example', 'page', ''],
			['b.example', 'page', '/x'],
		])
	})

	it('caps a pair per first value, so a goal’s or an item’s tail stays its own', () => {
		const pair = kind('goal', 'source')
		const rows = [
			...['google', 'bing', 'news'].map((value2, i) => ({
				...row(pair, 'purchase', { pageviews: 3 - i, conversions: 3 - i }),
				value2,
			})),
			{ ...row(pair, 'lead', { pageviews: 1, conversions: 1 }), value2: 'news' },
		]
		const capped = capDay(rows, { ...DEFAULT_CAPS, goalPairs: 1 })
		expect(capped.map((each) => [each.value, each.value2, each.parts.conversions])).toEqual([
			['purchase', 'google', 3],
			['purchase', '', 3],
			['lead', 'news', 1],
		])
	})

	it('writes the same content id whichever generation writes a row, in id order', () => {
		const rows = [
			row(kind('page'), '/b', { pageviews: 1 }),
			row(kind('page'), '/a', { pageviews: 2 }),
		]
		const recordsOf = (gen: string) =>
			rows.map((each) => recordOf(WINDOW, each, gen)).sort(byRecordId)
		const first = recordsOf('G1')
		const second = recordsOf('G2')
		expect(first.map((record) => record.id)).toEqual(second.map((record) => record.id))
		expect(first.map((record) => record.id)).toEqual([...first.map((r) => r.id)].sort())
		expect(first.find((record) => record.value === '/a')?.id).toBe(
			aggregateId({
				scope: 's',
				day: 20261006,
				hostname: 'a.example',
				dim: 'page',
				value: '/a',
				dim2: '',
				value2: '',
			})
		)
	})

	it('completes a day with its generation, version and final time, the lease cleared', () => {
		expect(completedMarker(WINDOW, { status: 'provisional', gen: 'G1', hits: 4, at: NOW })).toEqual(
			{
				scope: 's',
				day: 20261006,
				tz: 'UTC',
				start: null,
				status: 'provisional',
				version: AGGREGATION_VERSION,
				gen: 'G1',
				hits: 4,
				leaseOwner: null,
				leaseUntil: null,
				finalAfter: new Date('2026-10-08T00:15:00.000Z'),
				aggregatedAt: NOW,
			}
		)
	})
})

describe('aggregate reads', () => {
	const base: AggregateRead = {
		scope: 's',
		days: [[20261001, 20261003]],
		dim: 'page',
		groupBy: 'value',
	}

	it('refuses reads the rows cannot answer', () => {
		expect(() => planAggregateRead({ ...base, dim2: 'source' })).toThrow(/no aggregate rows/)
		expect(() => planAggregateRead({ ...base, dim: '' })).toThrow(/site row has no values/)
		expect(() => planAggregateRead({ ...base, groupBy: 'value2' })).toThrow(/only a pair/)
		expect(() => planAggregateRead({ ...base, groupBy: 'day', values: ['/'] })).toThrow(
			/values fill in a breakdown/
		)
		expect(() => planAggregateRead({ ...base, days: [] })).toThrow(/at least one range/)
		expect(() => planAggregateRead({ ...base, days: [[20261003, 20261001]] })).toThrow(
			/not a range/
		)
		expect(() => planAggregateRead({ ...base, limit: 0 })).toThrow(/limit/)
		expect(
			planAggregateRead({ ...base, dim: 'item', dim2: 'page', groupBy: 'value2' })
		).toMatchObject({ group: 'value2', kind: { index: 24 } })
	})

	const matched = [
		{
			day: 20261001,
			value: '/a',
			value2: '',
			parts: { ...emptyParts(), pageviews: 2, events: 0, visitors: 2 },
		},
		{
			day: 20261002,
			value: '/a',
			value2: '',
			parts: { ...emptyParts(), pageviews: 1, events: 0, visitors: 1 },
		},
		{
			day: 20261002,
			value: '/b',
			value2: '',
			parts: { ...emptyParts(), pageviews: 4, events: 0, visitors: 3 },
		},
		{
			day: 20261002,
			value: '',
			value2: '',
			parts: { ...emptyParts(), pageviews: 5, events: 1, visitors: null },
		},
		{
			day: 20261003,
			value: '/z',
			value2: '',
			parts: { ...emptyParts(), pageviews: 0, events: 0, durationMs: 9 },
		},
	]

	it('sums values across days, drops (other) and what counted nothing visible, ranks and cuts', () => {
		const rows = answerAggregateRead(
			planAggregateRead({ ...base, order: { part: 'pageviews', dir: 'desc' }, limit: 2 }),
			matched
		)
		expect(rows.map((each) => [each.value, each.parts.pageviews, each.parts.visitors])).toEqual([
			['/b', 4, 3],
			['/a', 3, 3],
		])
		expect(answerAggregateRead(planAggregateRead(base), matched).map((each) => each.value)).toEqual(
			['/a', '/b']
		)
	})

	it('answers one row for a total, zeros where nothing completed counted', () => {
		const plan = planAggregateRead({ ...base, groupBy: 'total' })
		expect(answerAggregateRead(plan, matched)).toEqual([
			{
				value: null,
				parts: expect.objectContaining({ pageviews: 12, events: 1, visitors: 6, durationMs: 9 }),
			},
		])
		expect(answerAggregateRead(plan, [])).toEqual([
			{
				value: null,
				parts: expect.objectContaining({ pageviews: 0, sessions: 0, impressions: null }),
			},
		])
	})

	it('fills in exactly the values asked for, and series by day', () => {
		expect(
			answerAggregateRead(planAggregateRead({ ...base, values: ['/b', '/nope'] }), matched).map(
				(each) => each.value
			)
		).toEqual(['/b'])
		expect(
			answerAggregateRead(planAggregateRead({ ...base, groupBy: 'day' }), matched).map((each) => [
				each.day,
				each.parts.pageviews,
			])
		).toEqual([
			[20261001, 2],
			[20261002, 10],
		])
	})
})

/** A writer holding rows in memory, failing a write when asked. */
const memoryWriter = (fail?: (written: number) => boolean) => {
	const rows = new Map<string, AggregateRecord>()
	const dropped: string[][] = []
	let written = 0
	const writer: GenerationWriter = {
		async gens(window) {
			return [
				...new Set(
					[...rows.values()]
						.filter((record) => record.scope === window.scope && record.day === window.day)
						.map((record) => record.gen)
				),
			]
		},
		async write(records) {
			for (const record of records) {
				rows.set(`${record.id}:${record.gen}`, record)
			}
			written += records.length
			if (fail?.(written)) {
				throw new Error('the database went away')
			}
		},
		async drop(_window, gens) {
			dropped.push([...gens])
			for (const [key, record] of rows) {
				if (gens.includes(record.gen)) {
					rows.delete(key)
				}
			}
		},
	}
	return { writer, rows, dropped }
}

describe('writing a day beside the readable one', () => {
	const rows = Array.from({ length: 600 }, (_, i) => row(kind('page'), `/p${i}`, { pageviews: 1 }))

	const prepared = async (owner: string) => {
		const state = memoryStateStore({ now: () => NOW })
		await state.ensureMarkers([{ scope: 's', day: 20261006, tz: 'UTC' }])
		expect(await state.claim(dayKey('s', 20261006), owner, DAY_LEASE_MS)).toBe(true)
		return state
	}

	it('writes in chunks, completes, then deletes only the generations it knows are dead', async () => {
		const state = await prepared('run-1')
		const { writer, rows: stored, dropped } = memoryWriter()
		for (const leftover of rows.slice(0, 1).map((each) => recordOf(WINDOW, each, 'LEFTOVER'))) {
			stored.set(`${leftover.id}:LEFTOVER`, leftover)
		}
		const chunks: number[] = []
		const result = await writeBeside({
			state,
			writer,
			window: WINDOW,
			run: { runId: 'run-1', status: 'final', gen: null },
			rows,
			hits: 600,
			now: () => NOW,
			hooks: { afterChunk: async (written) => void chunks.push(written) },
		})
		expect(result).toEqual({ completed: true, hits: 600, rows: 600 })
		expect(chunks).toEqual([500, 600])
		const [marker] = await state.markers('s', 20261006, 20261006)
		expect(marker).toMatchObject({ status: 'final', hits: 600, leaseOwner: null })
		expect(dropped).toEqual([['LEFTOVER']])
		expect(new Set([...stored.values()].map((record) => record.gen))).toEqual(
			new Set([marker?.gen])
		)
		expect(await state.drops(10)).toEqual([])
	})

	it('leaves its drop note behind when it stops between completing and dropping', async () => {
		const state = await prepared('run-1')
		const { writer } = memoryWriter()
		await expect(
			writeBeside({
				state,
				writer,
				window: WINDOW,
				run: { runId: 'run-1', status: 'final', gen: null },
				rows,
				hits: 600,
				now: () => NOW,
				hooks: {
					afterComplete: async () => {
						throw new Error('the process was killed')
					},
				},
			})
		).rejects.toThrow('the process was killed')
		const [marker] = await state.markers('s', 20261006, 20261006)
		expect(await state.drops(10)).toEqual([{ scope: 's', day: 20261006, gen: marker?.gen }])
	})

	it('yields to a run that completed the day meanwhile, writing nothing', async () => {
		const state = await prepared('run-1')
		const { writer, rows: stored } = memoryWriter()
		const result = await writeBeside({
			state,
			writer,
			window: WINDOW,
			run: { runId: 'run-1', status: 'final', gen: 'OLDER' },
			rows,
			hits: 600,
			now: () => NOW,
		})
		expect(result).toEqual({ completed: false, hits: 600, rows: 0 })
		expect(stored.size).toBe(0)
	})

	it('drops what it wrote when its completion is refused, or a write fails', async () => {
		const state = await prepared('run-1')
		const { writer, rows: stored } = memoryWriter()
		const refused = await writeBeside({
			state,
			writer,
			window: WINDOW,
			run: { runId: 'run-1', status: 'final', gen: null },
			rows,
			hits: 600,
			now: () => NOW,
			hooks: { afterChunk: async () => state.markDirty('s', [20261006]) },
		})
		expect(refused).toMatchObject({ completed: false, rows: 0 })
		expect(stored.size).toBe(0)

		const failing = memoryWriter((written) => written > 500)
		const again = await prepared('run-2')
		await expect(
			writeBeside({
				state: again,
				writer: failing.writer,
				window: WINDOW,
				run: { runId: 'run-2', status: 'final', gen: null },
				rows,
				hits: 600,
				now: () => NOW,
			})
		).rejects.toThrow('the database went away')
		expect(failing.rows.size).toBe(0)
		expect((await again.markers('s', 20261006, 20261006))[0]?.gen).toBeNull()
	})
})

describe('folded values', () => {
	const read = { scope: 's', days: [[20261001, 20261003]] as Array<[number, number]> }
	const fold = (day: number, hostname: string, [value, value2 = '']: [string, string?]) => ({
		day,
		hostname,
		value,
		value2,
	})

	it('finds a day folded where a hostname kept an (other) row and no row of the value', () => {
		const target = { ...read, dim: 'referrer' as const, value: 'news.example' }
		const kind = planFoldRead(target)
		expect(
			foldedDaysOf(kind, target, [
				fold(20261001, 'a', ['']),
				fold(20261001, 'a', ['news.example']),
				fold(20261002, 'a', ['']),
				fold(20261002, 'b', ['news.example']),
				fold(20261003, 'b', ['news.example']),
			])
		).toEqual([20261002])
	})

	it('finds a pair folded wherever its first value kept an (other) row', () => {
		const target = { ...read, dim: 'goal' as const, dim2: 'source' as const, value: 'purchase' }
		const kind = planFoldRead(target)
		expect(
			foldedDaysOf(kind, target, [
				fold(20261003, 'a', ['purchase']),
				fold(20261001, 'b', ['purchase']),
			])
		).toEqual([20261001, 20261003])
	})

	it('refuses a fold read of the site row, of (other) itself, or of no days', () => {
		expect(() => planFoldRead({ ...read, dim: '', value: 'x' })).toThrow(/no folded values/)
		expect(() => planFoldRead({ ...read, dim: 'page', value: '' })).toThrow(/never the \(other\)/)
		expect(() => planFoldRead({ ...read, days: [], dim: 'page', value: '/' })).toThrow(
			/at least one range/
		)
	})
})

describe('stable reads', () => {
	it('reads again when a day changed generation while it was read, and gives up after three', async () => {
		const sequence = ['G0', 'G1', 'G1', 'G1']
		let turn = 0
		const gens = async () => new Map([[dayGenKey('s', 1), sequence[turn++] ?? 'G1']])
		let reads = 0
		const answer = await readStable({
			gens,
			rows: async () => {
				reads++
				return reads
			},
		})
		expect(answer).toBe(2)
		await expect(
			readStable({ gens: async () => new Map([['x', String(turn++)]]), rows: async () => 0 })
		).rejects.toThrow(/rewritten during each of 3 reads/)
	})

	it('takes a day completed during the read as not read, not as changed', async () => {
		let turn = 0
		const answer = await readStable({
			gens: async () => (turn++ === 0 ? new Map() : new Map([[dayGenKey('s', 1), 'G1']])),
			rows: async () => 'read',
		})
		expect(answer).toBe('read')
	})
})
