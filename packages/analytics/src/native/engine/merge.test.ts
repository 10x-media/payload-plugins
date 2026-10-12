import { describe, expect, it } from 'vitest'
import { emptyParts, type MetricParts } from '../store/parts'
import type { RawOrder } from '../store/types'
import { CANDIDATE_HEADROOM, type RankedSide, sumByValue, topAcross, type ValueRow } from './merge'

const BY_PAGEVIEWS: RawOrder = { part: 'pageviews', dir: 'desc' }

const parts = (pageviews: number, more: Partial<MetricParts> = {}): MetricParts => ({
	...emptyParts(),
	pageviews,
	...more,
})

const row = (value: string, pageviews: number): ValueRow => ({ value, parts: parts(pageviews) })

/** A side over fixed rows, ranking and filling them the way a store does, and logging each call. */
const sideOf = (rows: readonly ValueRow[], order: RawOrder = BY_PAGEVIEWS) => {
	const calls: Array<{ top?: number | undefined; fill?: readonly string[] }> = []
	const ranked = [...rows].sort(
		(a, b) =>
			(order.dir === 'desc' ? -1 : 1) * ((a.parts.pageviews ?? 0) - (b.parts.pageviews ?? 0)) ||
			(a.value < b.value ? -1 : 1)
	)
	const side: RankedSide = {
		async top(limit) {
			calls.push({ top: limit })
			const cut = limit === undefined ? ranked : ranked.slice(0, limit)
			return { rows: cut, complete: limit === undefined || cut.length < limit }
		},
		async fill(values) {
			calls.push({ fill: values })
			return rows.filter((entry) => values.includes(entry.value))
		},
	}
	return { side, calls }
}

describe('top values across sides', () => {
	it('lets a single side rank itself, exactly, asking for no more than the limit', async () => {
		const { side, calls } = sideOf([row('/a', 3), row('/b', 9), row('/c', 5)])
		expect((await topAcross([side], BY_PAGEVIEWS, 2)).map((entry) => entry.value)).toEqual([
			'/b',
			'/c',
		])
		expect(calls).toEqual([{ top: 2 }])
	})

	it('fills in exactly a candidate a side ranked below its offer, then ranks the sums', async () => {
		// The aggregated days rank sixty pages; the page today brings in sits last among them.
		const days = sideOf(Array.from({ length: 60 }, (_, i) => row(`/p${i}`, 100 - i)))
		const today = sideOf([row('/p59', 200), row('/p0', 1)])
		const top = await topAcross([days.side, today.side], BY_PAGEVIEWS, 2)
		expect(top.map((entry) => [entry.value, entry.parts.pageviews])).toEqual([
			['/p59', 241],
			['/p0', 101],
		])
		expect(days.calls).toEqual([{ top: 2 + CANDIDATE_HEADROOM }, { fill: ['/p59'] }])
		expect(today.calls).toEqual([{ top: 2 + CANDIDATE_HEADROOM }])
	})

	it('asks a side that offered everything it has for nothing more', async () => {
		const a = sideOf([row('/x', 5)])
		const b = sideOf([row('/y', 4), row('/z', 1)])
		const top = await topAcross([a.side, b.side], BY_PAGEVIEWS, 3)
		expect(top.map((entry) => entry.value)).toEqual(['/x', '/y', '/z'])
		expect([...a.calls, ...b.calls].some((call) => call.fill !== undefined)).toBe(false)
	})

	it('adds every row of every side without a limit, ties going by value', async () => {
		const a = sideOf([row('/b', 2), row('/a', 1)])
		const b = sideOf([row('/a', 1), row('/c', 2)])
		const top = await topAcross([a.side, b.side], BY_PAGEVIEWS, undefined)
		expect(top.map((entry) => [entry.value, entry.parts.pageviews])).toEqual([
			['/a', 2],
			['/b', 2],
			['/c', 2],
		])
		expect(a.calls).toEqual([{ top: undefined }])
	})

	it('ranks by a ratio of parts, a value with nothing to divide by last', async () => {
		const order: RawOrder = { part: 'bounces', per: 'entries', dir: 'asc' }
		const a: RankedSide = {
			top: async () => ({
				rows: [
					{ value: 'none', parts: parts(1, { bounces: 0, entries: 0 }) },
					{ value: 'half', parts: parts(1, { bounces: 1, entries: 2 }) },
				],
				complete: true,
			}),
			fill: async () => [],
		}
		const b: RankedSide = {
			top: async () => ({
				rows: [{ value: 'quarter', parts: parts(1, { bounces: 1, entries: 4 }) }],
				complete: true,
			}),
			fill: async () => [],
		}
		expect((await topAcross([a, b], order, undefined)).map((entry) => entry.value)).toEqual([
			'quarter',
			'half',
			'none',
		])
	})

	it('answers nothing without a side', async () => {
		expect(await topAcross([], BY_PAGEVIEWS, 5)).toEqual([])
	})

	it('sums the rows of one value, a part one row does not count staying the other one', () => {
		expect(
			sumByValue([
				{ value: '/a', parts: parts(1, { sessions: null }) },
				{ value: '/a', parts: parts(2, { sessions: 3 }) },
			])
		).toEqual([{ value: '/a', parts: parts(3, { sessions: 3 }) }])
	})
})
