import { describe, expect, it } from 'vitest'
import { dayFinalAfter, dayKey, leaseKey } from '../state'
import type { DayMarker } from '../types'
import { memoryStateStore } from './memoryState'

const MINUTE = 60_000

const clocked = () => {
	const clock = { at: Date.parse('2026-10-06T12:00:00.000Z') }
	return {
		now: () => new Date(clock.at),
		advance: (ms: number) => {
			clock.at += ms
		},
	}
}

describe('memoryStateStore', () => {
	it('hands a lease to one owner until it expires or is given back', async () => {
		const time = clocked()
		const state = memoryStateStore({ now: time.now })
		const key = leaseKey('maintain')
		expect(await state.claim(key, 'a', 10 * MINUTE)).toBe(true)
		expect(await state.claim(key, 'b', 10 * MINUTE)).toBe(false)
		expect(await state.claim(key, 'a', 10 * MINUTE)).toBe(true)
		time.advance(11 * MINUTE)
		expect(await state.claim(key, 'b', 10 * MINUTE)).toBe(true)
		expect(await state.release(key, 'a')).toBe(false)
		expect(await state.release(key, 'b')).toBe(true)
		expect(await state.claim(key, 'a', MINUTE)).toBe(true)
		await expect(state.claim('nope', 'a', MINUTE)).rejects.toThrow(/neither a lease/)
	})

	it('creates markers once, needs one before a day lease, and fences completion on it', async () => {
		const time = clocked()
		const state = memoryStateStore({ now: time.now })
		const key = dayKey('s', 20261005)
		expect(await state.claim(key, 'run', MINUTE)).toBe(false)
		await state.ensureMarkers([{ scope: 's', day: 20261005, tz: 'UTC' }])
		await state.ensureMarkers([{ scope: 's', day: 20261005, tz: 'Europe/Berlin' }])
		const [marker] = await state.markers('s', 20261001, 20261010)
		expect(marker).toEqual({
			scope: 's',
			day: 20261005,
			tz: 'UTC',
			start: null,
			status: 'open',
			version: null,
			gen: null,
			hits: null,
			leaseOwner: null,
			leaseUntil: null,
			finalAfter: dayFinalAfter(20261005, 'UTC'),
			aggregatedAt: null,
		})
		expect(await state.claim(key, 'run', MINUTE)).toBe(true)
		const done: DayMarker = {
			scope: 's',
			day: 20261005,
			tz: 'UTC',
			start: null,
			status: 'final',
			version: 1,
			gen: 'G1',
			hits: 3,
			leaseOwner: null,
			leaseUntil: null,
			finalAfter: null,
			aggregatedAt: time.now(),
		}
		expect(await state.complete(done, 'other')).toBe(false)
		expect(await state.complete(done, 'run')).toBe(true)
		expect((await state.markers('s', 20261005, 20261005))[0]).toMatchObject({
			status: 'final',
			gen: 'G1',
			leaseOwner: null,
		})
	})

	it('marks days dirty, revoking the running owner’s completion and renewal, the day free at once', async () => {
		const time = clocked()
		const state = memoryStateStore({ now: time.now })
		await state.ensureMarkers([{ scope: 's', day: 20261005, tz: 'UTC' }])
		const key = dayKey('s', 20261005)
		expect(await state.claim(key, 'run', 10 * MINUTE)).toBe(true)
		const [held] = await state.markers('s', 20261005, 20261005)
		expect(await state.attempt({ ...(held as DayMarker), failures: 2 }, 'run')).toBe(true)
		await state.markDirty('s', [20261005, 20261006])
		const [marker] = await state.markers('s', 20261005, 20261006)
		expect(marker).toMatchObject({ status: 'dirty', leaseOwner: null, leaseUntil: null })
		expect(marker).not.toHaveProperty('failures')
		expect(await state.complete({ ...(marker as DayMarker), gen: 'G' }, 'run')).toBe(false)
		expect(await state.renew(key, 'run', 10 * MINUTE)).toBe(false)
		expect(await state.pending(new Date('2026-10-07T00:00:00.000Z'), 10)).toHaveLength(1)
		expect(await state.claim(key, 'next', 10 * MINUTE)).toBe(true)
		expect(await state.renew(key, 'next', 10 * MINUTE)).toBe(true)
	})

	it('lists due days oldest first and leaves leased ones out', async () => {
		const time = clocked()
		const state = memoryStateStore({ now: time.now })
		await state.ensureMarkers([
			{ scope: 'b', day: 20261002, tz: 'UTC' },
			{ scope: 'a', day: 20261002, tz: 'UTC' },
			{ scope: 'a', day: 20261003, tz: 'UTC' },
		])
		const due = async (at: string) =>
			(await state.pending(new Date(at), 10)).map((marker) => `${marker.scope}:${marker.day}`)
		expect(await due('2026-10-03T00:10:00.000Z')).toEqual([])
		expect(await due('2026-10-03T00:15:00.000Z')).toEqual(['a:20261002', 'b:20261002'])
		expect(await state.claim(dayKey('a', 20261002), 'run', 10 * MINUTE)).toBe(true)
		expect(await due('2026-10-03T00:15:00.000Z')).toEqual(['b:20261002'])
		await expect(state.pending(new Date(), 0)).rejects.toThrow(RangeError)
	})

	it('keeps one salt per day until swept, and the last beat of each task', async () => {
		const time = clocked()
		const state = memoryStateStore({ now: time.now })
		const salt = await state.salt(20261003)
		expect(await state.salt(20261003)).toBe(salt)
		expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(await state.sweep(new Date('2026-10-05T23:59:59.999Z'))).toBe(0)
		expect(await state.sweep(new Date('2026-10-06T00:00:00.000Z'))).toBe(1)
		expect(await state.salt(20261003)).not.toBe(salt)
		expect(await state.lastBeat('analytics-maintain')).toBeNull()
		await state.beat('analytics-maintain')
		expect(await state.lastBeat('analytics-maintain')).toEqual(time.now())
	})

	it('keeps one configuration token per scope, the last one stored', async () => {
		const state = memoryStateStore()
		expect(await state.configToken('a')).toBeNull()
		await state.setConfigToken('a', 'one')
		await state.setConfigToken('a', 'two')
		expect(await state.configToken('a')).toBe('two')
		expect(await state.configToken('')).toBeNull()
	})

	it('keeps where each task’s run stopped, until a run that finished clears it', async () => {
		const state = memoryStateStore()
		expect(await state.cursor('analytics-sync')).toBeNull()
		await state.setCursor('analytics-sync', '"tenant-b"')
		expect(await state.cursor('analytics-sync')).toBe('"tenant-b"')
		expect(await state.cursor('analytics-warm')).toBeNull()
		await state.setCursor('analytics-sync', null)
		expect(await state.cursor('analytics-sync')).toBeNull()
	})

	it('refuses a clean completion of a day marked dirty after its lease was claimed', async () => {
		const state = memoryStateStore()
		await state.ensureMarkers([{ scope: 's', day: 20261005, tz: 'UTC' }])
		const key = dayKey('s', 20261005)
		const [open] = await state.markers('s', 20261005, 20261005)
		if (!open) throw new Error('expected a marker')
		const empty: DayMarker = { ...open, status: 'empty', hits: 0 }
		await state.markDirty('s', [20261005])
		expect(await state.claim(key, 'run', MINUTE)).toBe(true)
		expect(await state.complete(empty, 'run', { clean: true })).toBe(false)
		expect((await state.markers('s', 20261005, 20261005))[0]?.status).toBe('dirty')
		expect(await state.complete({ ...empty, status: 'final' }, 'run')).toBe(true)
	})
})
