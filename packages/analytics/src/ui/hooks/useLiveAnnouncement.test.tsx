import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveAnnouncement } from '../components/LiveAnnouncement'
import { ANNOUNCE_INTERVAL_MS, TURN_GAP_MS } from './useLiveAnnouncement'

/**
 * Counters on a page share their turns, so each test reads on a clock well past the last one's.
 * Each fake clock starts its monotonic time at zero, so a test moves it on by every hour so far.
 */
let elapsed = 0

beforeEach(() => {
	vi.useFakeTimers()
	elapsed += 3_600_000
	vi.advanceTimersByTime(elapsed)
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

const said = (container: HTMLElement): string =>
	container.querySelector('[aria-live="polite"]')?.textContent ?? ''

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('useLiveAnnouncement', () => {
	it('says nothing about the value it mounts with', () => {
		const { container } = render(<LiveAnnouncement message="3 active" />)
		expect(said(container)).toBe('')
		expect(container.querySelector('[aria-live]')?.className).toBe('analytics-sr-only')
	})

	it('says the first change at once and the next no sooner than a minute later', () => {
		const { container, rerender } = render(<LiveAnnouncement message="3 active" />)
		rerender(<LiveAnnouncement message="4 active" />)
		expect(said(container)).toBe('4 active')
		rerender(<LiveAnnouncement message="5 active" />)
		advance(ANNOUNCE_INTERVAL_MS - 1)
		expect(said(container)).toBe('4 active')
		advance(1)
		expect(said(container)).toBe('5 active')
	})

	it('says the value as it stands when the minute ends, not every step on the way', () => {
		const { container, rerender } = render(<LiveAnnouncement message="3" />)
		rerender(<LiveAnnouncement message="4" />)
		rerender(<LiveAnnouncement message="5" />)
		advance(20_000)
		rerender(<LiveAnnouncement message="6" />)
		advance(ANNOUNCE_INTERVAL_MS)
		expect(said(container)).toBe('6')
	})

	// 4, 5, 4 within the minute: by its end nothing differs from what was last said.
	it('says nothing when the value is back to what it last said', () => {
		const { container, rerender } = render(<LiveAnnouncement message="3" />)
		rerender(<LiveAnnouncement message="4" />)
		rerender(<LiveAnnouncement message="5" />)
		rerender(<LiveAnnouncement message="4" />)
		advance(ANNOUNCE_INTERVAL_MS * 2)
		expect(said(container)).toBe('4')
		rerender(<LiveAnnouncement message="4" />)
		advance(ANNOUNCE_INTERVAL_MS)
		expect(said(container)).toBe('4')
	})

	it('lets two counters on one page take turns rather than talk over each other', () => {
		const first = render(<LiveAnnouncement message="3 visitors" />)
		const second = render(<LiveAnnouncement message="10 pageviews" />)
		first.rerender(<LiveAnnouncement message="4 visitors" />)
		second.rerender(<LiveAnnouncement message="11 pageviews" />)
		expect(said(first.container)).toBe('4 visitors')
		expect(said(second.container)).toBe('')
		advance(TURN_GAP_MS - 1)
		expect(said(second.container)).toBe('')
		advance(1)
		expect(said(second.container)).toBe('11 pageviews')
	})

	it('keeps its last word while there is nothing to say', () => {
		const { container, rerender } = render(<LiveAnnouncement message="3" />)
		rerender(<LiveAnnouncement message="4" />)
		rerender(<LiveAnnouncement message={null} />)
		advance(ANNOUNCE_INTERVAL_MS)
		expect(said(container)).toBe('4')
	})
})
