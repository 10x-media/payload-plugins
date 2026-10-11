import { describe, expect, it } from 'vitest'
import { markInProgress } from './inProgress'
import type { TrendPoint } from './TrendChart'

const day = (at: string, value: number): TrendPoint => ({
	at,
	label: at.slice(5, 10),
	tooltipLabel: `Day ${at.slice(8, 10)}`,
	value,
	display: String(value),
})

const points = [
	day('2026-10-06T04:00:00.000Z', 10),
	day('2026-10-07T04:00:00.000Z', 12),
	day('2026-10-08T04:00:00.000Z', 3),
]

const soFar = (period: string) => `${period} (so far)`

describe('markInProgress', () => {
	it('marks the bucket now falls in, and says so where its period is named', () => {
		const now = new Date('2026-10-08T15:30:00.000Z')
		const marked = markInProgress(points, { now, end: now, soFar })
		expect(marked.map((point) => point.inProgress === true)).toEqual([false, false, true])
		expect(marked[2]?.tooltipLabel).toBe('Day 08 (so far)')
		expect(marked[1]?.tooltipLabel).toBe('Day 07')
	})

	it('leaves every reading as it was, so the totals still add up', () => {
		const now = new Date('2026-10-08T15:30:00.000Z')
		const marked = markInProgress(points, { now, end: now, soFar })
		expect(marked.map((point) => point.value)).toEqual([10, 12, 3])
		expect(marked.map((point) => point.display)).toEqual(['10', '12', '3'])
	})

	it('marks nothing in a window that ended before now', () => {
		const marked = markInProgress(points, {
			now: new Date('2026-10-12T09:00:00.000Z'),
			end: new Date('2026-10-09T04:00:00.000Z'),
			soFar,
		})
		expect(marked.some((point) => point.inProgress === true)).toBe(false)
		expect(marked).toBe(points)
	})

	it('marks the bucket holding now even where buckets after it are drawn', () => {
		const now = new Date('2026-10-07T10:00:00.000Z')
		const marked = markInProgress(points, {
			now,
			end: new Date('2026-10-09T04:00:00.000Z'),
			soFar,
		})
		expect(marked.map((point) => point.inProgress === true)).toEqual([false, true, false])
	})

	it('falls back to the axis label where a point names no tooltip label', () => {
		const now = new Date('2026-10-08T15:30:00.000Z')
		const [only] = markInProgress(
			[{ at: points[2]?.at ?? '', label: 'Oct 8', value: 1, display: '1' }],
			{
				now,
				end: now,
				soFar,
			}
		)
		expect(only?.tooltipLabel).toBe('Oct 8 (so far)')
	})
})
