import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeCounter, type RealtimeCounterProps } from './RealtimeCounter'

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const SAMPLED_LABEL = 'Numbers are approximate'
const INTERVAL_MS = 15_000

const required: RealtimeCounterProps = {
	endpoint: '/api/analytics/realtime',
	intervalMs: INTERVAL_MS,
	metric: 'visitors',
	windowMinutes: 30,
	initialActiveNow: 3,
	initialSeries: [{ date: '2026-09-14T06:00:00.000Z', value: 3 }],
	locale: 'en-US',
	caption: 'in the last 30 minutes',
	pausedLabel: 'paused',
}

const poll = (activeNow: number, sampled?: boolean): Response =>
	({
		ok: true,
		json: () =>
			Promise.resolve({
				status: 'ok',
				activeNow,
				series: [{ date: '2026-09-14T06:01:00.000Z', value: activeNow }],
				sampled,
			}),
	}) as Response

const tick = async () => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(INTERVAL_MS)
	})
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	vi.useFakeTimers()
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('RealtimeCounter', () => {
	it('renders with neither sampled prop, the shape a host embedding it can pass', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(poll(9, true)))
		)
		const { container } = render(<RealtimeCounter {...required} />)
		expect(screen.getByText('3')).toBeDefined()
		const spans = container.querySelectorAll('span').length
		await tick()
		// The poll said sampled, but without a label there is no notice element at all.
		expect(screen.getByText('9')).toBeDefined()
		expect(container.querySelectorAll('span').length).toBe(spans)
	})

	it('says a reading it mounts with was sampled', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(poll(3)))
		)
		render(<RealtimeCounter {...required} initialSampled sampledLabel={SAMPLED_LABEL} />)
		expect(screen.getByText(SAMPLED_LABEL)).toBeDefined()
	})

	it('stops polling once the endpoint refuses this reader, and still says paused', async () => {
		const refused = {
			ok: false,
			json: () => Promise.resolve({ error: { code: 'forbidden', message: 'no' } }),
		} as unknown as Response
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(refused))
		)
		render(<RealtimeCounter {...required} />)

		await tick()
		expect(screen.getByText('paused')).toBeDefined()
		expect(fetch).toHaveBeenCalledTimes(1)

		await tick()
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keeps polling through an outage and recovers on the next reading', async () => {
		const down = {
			ok: false,
			json: () => Promise.resolve({ error: { code: 'unavailable', message: 'down' } }),
		} as unknown as Response
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(down).mockResolvedValueOnce(poll(11)))
		render(<RealtimeCounter {...required} />)

		await tick()
		expect(screen.getByText('paused')).toBeDefined()

		await tick()
		expect(screen.getByText('11')).toBeDefined()
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('picks the flag up from a poll and drops it again on a clean one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValueOnce(poll(12, true)).mockResolvedValueOnce(poll(4, false))
		)
		render(<RealtimeCounter {...required} sampledLabel={SAMPLED_LABEL} />)
		expect(screen.queryByText(SAMPLED_LABEL)).toBeNull()

		await tick()
		expect(screen.getByText('12')).toBeDefined()
		expect(screen.getByText(SAMPLED_LABEL)).toBeDefined()

		await tick()
		expect(screen.getByText('4')).toBeDefined()
		expect(screen.queryByText(SAMPLED_LABEL)).toBeNull()
	})
})
