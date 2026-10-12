import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeReading } from '../../widgets/realtimePoll'
import { type RealtimePoll, useRealtimePoll } from './useRealtimePoll'

const INTERVAL_MS = 15_000

let latest: RealtimePoll | null = null

const Probe = ({ url, initial }: { url: string; initial?: RealtimeReading }) => {
	latest = useRealtimePoll({ url, intervalMs: INTERVAL_MS, ...(initial ? { initial } : {}) })
	return null
}

const reading = (activeNow: number): Response =>
	Response.json({
		status: 'ok',
		activeNow,
		series: [{ date: '2026-09-14T06:00:00.000Z', value: activeNow }],
	})

const tick = async (ms = INTERVAL_MS) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

let visibility: DocumentVisibilityState = 'visible'

const setVisibility = async (next: DocumentVisibilityState) => {
	visibility = next
	await act(async () => {
		document.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
	})
}

beforeEach(() => {
	latest = null
	visibility = 'visible'
	vi.useFakeTimers()
	vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
	vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('useRealtimePoll', () => {
	it('reads at once without a reading, then once per interval', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(reading(3)))
		render(<Probe url="/api/_x/live?metric=visitors" />)
		expect(latest?.settled).toBe(false)
		await tick(0)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(latest?.reading?.activeNow).toBe(3)
		expect(latest?.settled).toBe(true)

		await tick()
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' })
	})

	it('mounts with a server reading and waits for the interval before the first poll', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(reading(9)))
		const initial: RealtimeReading = { activeNow: 2, series: [], sampled: false }
		render(<Probe initial={initial} url="/api/_x/live" />)
		expect(latest?.reading?.activeNow).toBe(2)
		await tick(0)
		expect(fetch).not.toHaveBeenCalled()
		await tick()
		expect(latest?.reading?.activeNow).toBe(9)
	})

	it('pauses on a hidden tab and resumes with an immediate read', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(reading(4)))
		render(<Probe url="/api/_x/live" />)
		await tick(0)
		expect(fetch).toHaveBeenCalledTimes(1)

		await setVisibility('hidden')
		await tick(INTERVAL_MS * 4)
		expect(fetch).toHaveBeenCalledTimes(1)

		await setVisibility('visible')
		expect(fetch).toHaveBeenCalledTimes(2)
		await tick()
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('stops for good on a 401 or a 403 and says paused', async () => {
		for (const status of [401, 403]) {
			vi.mocked(fetch).mockReset()
			vi.mocked(fetch).mockImplementation(() =>
				Promise.resolve(
					Response.json(
						{ error: { code: status === 401 ? 'unauthorized' : 'forbidden', message: 'no' } },
						{ status }
					)
				)
			)
			const { unmount } = render(<Probe url={`/api/_x/live?case=${status}`} />)
			await tick(0)
			expect(latest?.paused).toBe(true)
			expect(latest?.settled).toBe(true)
			await tick(INTERVAL_MS * 3)
			await setVisibility('hidden')
			await setVisibility('visible')
			expect(fetch).toHaveBeenCalledTimes(1)
			unmount()
		}
	})

	it('keeps polling through an outage, holding the last reading, and recovers', async () => {
		vi.mocked(fetch)
			.mockImplementationOnce(() => Promise.resolve(reading(5)))
			.mockImplementationOnce(() =>
				Promise.resolve(
					Response.json(
						{ error: { code: 'unavailable', message: 'down' } },
						{ status: 503, headers: { 'Retry-After': '30' } }
					)
				)
			)
			.mockImplementation(() => Promise.resolve(reading(6)))
		render(<Probe url="/api/_x/live" />)
		await tick(0)
		await tick()
		expect(latest?.paused).toBe(true)
		expect(latest?.reading?.activeNow).toBe(5)
		await tick()
		expect(latest?.paused).toBe(false)
		expect(latest?.reading?.activeNow).toBe(6)
	})

	// An inline seed is a new object on every render: only other numbers may replace the poll's.
	it('keeps the polled reading when the seed comes back with the same numbers', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(reading(9)))
		const seed = (): RealtimeReading => ({ activeNow: 2, series: [], sampled: false })
		const { rerender } = render(<Probe initial={seed()} url="/api/_x/live" />)
		await tick()
		expect(latest?.reading?.activeNow).toBe(9)

		rerender(<Probe initial={seed()} url="/api/_x/live" />)
		expect(latest?.reading?.activeNow).toBe(9)

		rerender(<Probe initial={{ activeNow: 5, series: [], sampled: false }} url="/api/_x/live" />)
		expect(latest?.reading?.activeNow).toBe(5)
	})

	it('starts over for another URL rather than showing the last source its count', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(reading(7)))
		const { rerender } = render(<Probe url="/api/_x/live?dataSource=native" />)
		await tick(0)
		expect(latest?.reading?.activeNow).toBe(7)

		vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
		rerender(<Probe url="/api/_x/live?dataSource=plausible" />)
		expect(latest?.reading).toBeNull()
		expect(latest?.settled).toBe(false)
	})
})
