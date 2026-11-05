import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ENGAGEMENT_MS, MAX_SINCE_MS } from '../goals/constants'
import { createEngagement, ENGAGEMENT_MIN_MS, type Engagement } from './engagement'
import type { TrackerEvent } from './types'

const context = {
	path: '/pricing',
	hostname: 'shop.test',
	referrer: 'https://google.com/',
	query: 'utm_source=newsletter',
}

/** When each test's first pageview starts. */
const T0 = Date.parse('2026-10-01T23:58:00.000Z')

let dispatched: TrackerEvent[]
let depth: () => number | undefined
let engagement: Engagement

const setVisibility = (state: DocumentVisibilityState) => {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
	document.dispatchEvent(new Event('visibilitychange'))
}

const hide = () => setVisibility('hidden')
const show = () => setVisibility('visible')

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(T0)
	dispatched = []
	depth = () => undefined
	engagement = createEngagement({
		win: window,
		scrollDepth: () => depth(),
		dispatch: (event) => {
			dispatched.push(event)
		},
	})
})

afterEach(() => {
	engagement.destroy()
	Reflect.deleteProperty(document, 'visibilityState')
	vi.useRealTimers()
})

describe('engaged time', () => {
	it('sends the visible time, with its pageview context, when the tab is hidden', () => {
		engagement.start(context)
		vi.advanceTimersByTime(4000)
		hide()

		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, sinceMs: 4000, durationMs: 4000 },
		])
	})

	// Ingest files the time on the pageview's day, so time sent after midnight is not tomorrow's.
	it('says on every message how long ago its pageview was sent, however late it is sent', () => {
		engagement.start(context)
		vi.advanceTimersByTime(4000)
		hide()
		show()
		vi.advanceTimersByTime(180_000)
		hide()
		show()
		engagement.start({ ...context, path: '/checkout' })
		vi.advanceTimersByTime(2000)
		hide()

		expect(dispatched.map((event) => [event.path, event.sinceMs])).toEqual([
			['/pricing', 4000],
			['/pricing', 184_000],
			['/checkout', 2000],
		])
	})

	it("measures with the page's own clock, whatever the device's date says", () => {
		engagement.start(context)
		vi.advanceTimersByTime(4000)
		vi.setSystemTime(T0 - 3 * 86_400_000)
		hide()

		expect(dispatched.map((event) => event.sinceMs)).toEqual([4000])
	})

	it('never says its pageview was sent more than a day ago', () => {
		engagement.start(context)
		vi.advanceTimersByTime(MAX_SINCE_MS + 3_600_000)
		hide()

		expect(MAX_SINCE_MS).toBe(86_400_000)
		expect(dispatched.map((event) => event.sinceMs)).toEqual([MAX_SINCE_MS])
	})

	it('never sends more than half an hour of time in one message', () => {
		engagement.start(context)
		vi.advanceTimersByTime(MAX_ENGAGEMENT_MS + 15 * 60_000)
		hide()
		show()
		vi.advanceTimersByTime(2000)
		hide()

		expect(MAX_ENGAGEMENT_MS).toBe(30 * 60_000)
		expect(dispatched.map((event) => event.durationMs)).toEqual([MAX_ENGAGEMENT_MS, 2000])
	})

	it('pauses while hidden and sends only the new increment on the next hide', () => {
		engagement.start(context)
		vi.advanceTimersByTime(4000)
		hide()
		vi.advanceTimersByTime(60_000)
		show()
		vi.advanceTimersByTime(2500)
		hide()

		expect(dispatched.map((event) => event.durationMs)).toEqual([4000, 2500])
	})

	it('sends nothing when less than a second is new and the scroll did not deepen', () => {
		engagement.start(context)
		vi.advanceTimersByTime(ENGAGEMENT_MIN_MS - 1)
		hide()
		engagement.send()

		expect(dispatched).toEqual([])
	})

	it('keeps time too short to send and adds it to the next message', () => {
		engagement.start(context)
		vi.advanceTimersByTime(600)
		hide()
		show()
		vi.advanceTimersByTime(600)
		hide()

		expect(dispatched.map((event) => event.durationMs)).toEqual([1200])
	})

	it('keeps counting after a send made while the tab is visible', () => {
		engagement.start(context)
		vi.advanceTimersByTime(2000)
		engagement.send()
		vi.advanceTimersByTime(1500)
		hide()

		expect(dispatched.map((event) => event.durationMs)).toEqual([2000, 1500])
	})

	it('starts counting only once a page that opened hidden is shown', () => {
		setVisibility('hidden')
		engagement.start(context)
		vi.advanceTimersByTime(30_000)
		show()
		vi.advanceTimersByTime(1500)
		hide()

		expect(dispatched.map((event) => event.durationMs)).toEqual([1500])
	})

	it('drops what the previous pageview had not sent when the next one starts', () => {
		engagement.start(context)
		vi.advanceTimersByTime(800)
		engagement.start({ ...context, path: '/checkout' })
		vi.advanceTimersByTime(1000)
		hide()

		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, path: '/checkout', sinceMs: 1000, durationMs: 1000 },
		])
	})
})

describe('scroll depth', () => {
	it('sends how much deeper the page was scrolled since the previous message', () => {
		let deepest = 40
		depth = () => deepest
		engagement.start(context)
		hide()
		show()
		deepest = 70
		hide()
		show()
		vi.advanceTimersByTime(500)
		hide()

		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, sinceMs: 0, scrollDepth: 40 },
			{ type: 'engagement', ...context, sinceMs: 0, scrollDepth: 30 },
		])
	})

	it('sends a deeper scroll on its own, under a second of time', () => {
		depth = () => 25
		engagement.start(context)
		vi.advanceTimersByTime(300)
		hide()

		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, sinceMs: 300, durationMs: 300, scrollDepth: 25 },
		])
	})

	it('carries no scroll depth while scroll capture is off', () => {
		engagement.start(context)
		vi.advanceTimersByTime(2000)
		hide()

		expect(dispatched[0]).not.toHaveProperty('scrollDepth')
	})

	it('measures each pageview from zero', () => {
		depth = () => 60
		engagement.start(context)
		hide()
		show()
		engagement.start({ ...context, path: '/checkout' })
		hide()

		expect(dispatched.map((event) => [event.path, event.scrollDepth])).toEqual([
			['/pricing', 60],
			['/checkout', 60],
		])
	})

	it('still sends the time when reading the scroll position throws', () => {
		depth = () => {
			throw new Error('layout is gone')
		}
		engagement.start(context)
		vi.advanceTimersByTime(2000)

		expect(() => hide()).not.toThrow()
		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, sinceMs: 2000, durationMs: 2000 },
		])
	})
})

describe('leaving the page', () => {
	it('sends on pagehide and stops the clock while the page is frozen', () => {
		engagement.start(context)
		vi.advanceTimersByTime(3000)
		window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
		vi.advanceTimersByTime(60_000)
		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
		vi.advanceTimersByTime(2000)
		hide()

		expect(dispatched.map((event) => [event.path, event.durationMs])).toEqual([
			['/pricing', 3000],
			['/pricing', 2000],
		])
	})

	it('has nothing new to send on the pagehide that follows a hide', () => {
		engagement.start(context)
		vi.advanceTimersByTime(3000)
		hide()
		window.dispatchEvent(new PageTransitionEvent('pagehide'))

		expect(dispatched).toHaveLength(1)
	})
})

describe('stop and destroy', () => {
	it('sends nothing for a pageview whose measurement was stopped', () => {
		engagement.start(context)
		vi.advanceTimersByTime(3000)
		engagement.stop()
		hide()
		engagement.send()

		expect(dispatched).toEqual([])
	})

	it('sends nothing before the first pageview starts', () => {
		vi.advanceTimersByTime(3000)
		hide()

		expect(dispatched).toEqual([])
	})

	it('detaches its listeners on destroy', () => {
		engagement.start(context)
		vi.advanceTimersByTime(3000)
		engagement.destroy()
		hide()
		window.dispatchEvent(new PageTransitionEvent('pagehide'))

		expect(dispatched).toEqual([])
	})
})

describe('items seen', () => {
	let seen: string[]

	beforeEach(() => {
		engagement.destroy()
		seen = []
		engagement = createEngagement({
			win: window,
			scrollDepth: () => depth(),
			takeImpressions: () => seen.splice(0),
			dispatch: (event) => {
				dispatched.push(event)
			},
		})
	})

	it('carries the items seen since the previous message beside the time', () => {
		engagement.start(context)
		seen.push('offers:1', 'offers:2')
		vi.advanceTimersByTime(3000)
		hide()

		expect(dispatched).toEqual([
			{
				type: 'engagement',
				...context,
				sinceMs: 3000,
				durationMs: 3000,
				impressions: ['offers:1', 'offers:2'],
			},
		])
	})

	it('sends an item seen on its own, under a second of time', () => {
		engagement.start(context)
		seen.push('offers:1')
		vi.advanceTimersByTime(200)
		engagement.send()

		expect(dispatched).toEqual([
			{ type: 'engagement', ...context, sinceMs: 200, durationMs: 200, impressions: ['offers:1'] },
		])
	})

	it('hands each item over once', () => {
		engagement.start(context)
		seen.push('offers:1')
		engagement.send()
		engagement.send()

		expect(dispatched).toHaveLength(1)
	})

	it('takes nothing while no pageview is being measured', () => {
		seen.push('offers:1')
		engagement.send()

		expect(dispatched).toEqual([])
		expect(seen).toEqual(['offers:1'])
	})
})
