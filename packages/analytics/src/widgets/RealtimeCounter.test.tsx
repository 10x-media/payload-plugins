import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translations } from '../translations'
import { en } from '../translations/en'
import { ko } from '../translations/ko'
import { RealtimeCounter, type RealtimeCounterProps } from './RealtimeCounter'

/** The admin's language and its strings, which a test switches to read another locale. */
const admin = vi.hoisted(() => ({ language: 'en', strings: {} as Record<string, string> }))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		i18n: {
			language: admin.language,
			translations: Reflect.get(translations, admin.language),
		},
		t: (key: string, vars?: Record<string, string>) =>
			(admin.strings[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) =>
				String(vars?.[name.trim()] ?? match)
			),
	}),
}))

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const SAMPLED_LABEL = 'Numbers are approximate'
const INTERVAL_MS = 15_000

const required: RealtimeCounterProps = {
	endpoint: '/api/_x/live',
	intervalMs: INTERVAL_MS,
	metric: 'visitors',
	windowMinutes: 30,
	initialActiveNow: 3,
	initialSeries: [{ date: '2026-09-14T06:00:00.000Z', value: 3 }],
	locale: 'en-US',
	timezone: 'UTC',
	label: 'Visitors',
	caption: 'in the last 30 minutes',
	pausedLabel: 'paused',
}

const { caption: _caption, ...phrased } = required

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

/** The number the counter shows, and the words beside it: the readout a reader sees. */
const shown = (): string => document.querySelector('.analytics-widget__value')?.textContent ?? ''
const beside = (): string =>
	document.querySelector('.analytics-widget__value-caption')?.textContent ?? ''

const tick = async () => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(INTERVAL_MS)
	})
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	vi.useFakeTimers()
	admin.language = 'en'
	admin.strings = en
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
		expect(shown()).toBe('3')
		const spans = container.querySelectorAll('span').length
		await tick()
		// The poll said sampled, but without a label there is no notice element at all.
		expect(shown()).toBe('9')
		expect(container.querySelectorAll('span').length).toBe(spans)
	})

	it('draws three minutes on its axis, the last naming the reporting zone', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(poll(3)))
		)
		const series = Array.from({ length: 30 }, (_, i) => ({
			date: new Date(Date.UTC(2026, 8, 14, 6, i)).toISOString(),
			value: i % 4,
		}))
		const { container } = render(<RealtimeCounter {...required} initialSeries={series} />)
		const ticks = [...container.querySelectorAll('.analytics-chart__tick')].map(
			(tick) => tick.textContent
		)
		expect(ticks).toEqual(['06:00 AM', '06:15 AM', '06:29 AM UTC'])
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
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					Response.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 })
				)
			)
		)
		render(<RealtimeCounter {...required} />)

		await tick()
		expect(beside()).toBe('paused')
		expect(fetch).toHaveBeenCalledTimes(1)

		await tick()
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keeps polling through an outage and recovers on the next reading', async () => {
		const down = Response.json(
			{ error: { code: 'unavailable', message: 'down' } },
			{ status: 503, headers: { 'Retry-After': '30' } }
		)
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(down).mockResolvedValueOnce(poll(11)))
		render(<RealtimeCounter {...required} />)

		await tick()
		expect(beside()).toBe('paused')

		await tick()
		expect(shown()).toBe('11')
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
		expect(shown()).toBe('12')
		expect(screen.getByText(SAMPLED_LABEL)).toBeDefined()

		await tick()
		expect(shown()).toBe('4')
		expect(screen.queryByText(SAMPLED_LABEL)).toBeNull()
	})

	// The number changes every poll; only the hidden region says so, and only when it changed.
	it('is no live region itself and announces a changed count from a hidden one', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(poll(9)).mockResolvedValue(poll(10)))
		const { container } = render(<RealtimeCounter {...required} />)
		const live = container.querySelectorAll('[aria-live]')
		expect(live).toHaveLength(1)
		expect(live[0]?.classList.contains('analytics-sr-only')).toBe(true)
		expect(live[0]?.textContent).toBe('')

		await tick()
		expect(live[0]?.textContent).toBe('9 in the last 30 minutes')

		await tick()
		// Fifteen seconds after the last announcement, the next one waits out the minute.
		expect(live[0]?.textContent).toBe('9 in the last 30 minutes')
		await act(async () => {
			await vi.advanceTimersByTimeAsync(45_000)
		})
		expect(live[0]?.textContent).toBe('10 in the last 30 minutes')
	})
})

describe('RealtimeCounter without a caption', () => {
	it('words the count for the number, in one phrase with the number set apart', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(poll(1)))
		render(<RealtimeCounter {...phrased} initialActiveNow={12} />)
		expect(shown()).toBe('12')
		expect(beside()).toBe('visitors active right now')

		await tick()
		expect(shown()).toBe('1')
		expect(beside()).toBe('visitor active right now')
	})

	it('keeps the words where the language puts them around the number', () => {
		admin.language = 'ko'
		admin.strings = ko
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(poll(3)))
		const { container } = render(<RealtimeCounter {...phrased} initialActiveNow={3} />)
		const row = container.querySelector('.analytics-widget__value-row')
		expect([...(row?.children ?? [])].map((child) => child.textContent)).toEqual([
			'현재 활성 방문자',
			'3',
			'명',
		])
	})

	// A pageview count is no "right now": it says the minutes it covers, aloud as on screen.
	it('counts pageviews in their own phrase, naming the window they cover', () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(poll(2)))
		render(<RealtimeCounter {...phrased} initialActiveNow={2} metric="pageviews" />)
		expect(beside()).toBe('pageviews in the last 30 minutes')
	})
})
