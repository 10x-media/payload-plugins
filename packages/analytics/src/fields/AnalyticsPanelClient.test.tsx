import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { a11yViolations } from '../testing/a11y'
import { keys, pluralKeys } from '../translations/keys'
import { mergeNotices } from '../widgets/readMeta'
import {
	AnalyticsPanelClient,
	type AnalyticsPanelClientProps,
	type PanelData,
	type PanelSeed,
} from './AnalyticsPanelClient'

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../testing/selectMocks')).selectMocks,
	ShimmerEffect: () => <div data-testid="shimmer" />,
	Banner: ({ children }: { children?: ReactNode }) => <div role="alert">{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		<button onClick={onClick} type="button">
			{children}
		</button>
	),
	Pill: ({ children, className }: { children?: ReactNode; className?: string }) => (
		<span className={className}>{children}</span>
	),
	useConfig: () => ({ config: { routes: { api: '/api' }, serverURL: '' } }),
	useDocumentInfo: () => ({ id: 'doc-1' }),
	useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}))

const day = (iso: string, value: number) => ({ date: `${iso}T00:00:00.000Z`, value })

/** When the server rendered the panel: during the fixture's last day, which is still counting. */
const RENDERED_AT = '2026-06-02T12:00:00.000Z'

const panel = (over: Partial<PanelData> = {}): PanelData => ({
	status: 'ok',
	metrics: { pageviews: 120 },
	supportedMetrics: ['pageviews'],
	timezone: 'UTC',
	points: [day('2026-06-01', 50), day('2026-06-02', 70)],
	seriesGranularity: 'day',
	...over,
})

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const answer = (data: PanelData): Response =>
	({ ok: true, json: () => Promise.resolve(data) }) as Response

/** A page's panel seeded with {@link panel}, one metric and no lists; `over` replaces any prop. */
const renderPanel = (over: Partial<AnalyticsPanelClientProps> = {}) =>
	render(
		<AnalyticsPanelClient
			collectionSlug="pages"
			countryFlags={false}
			dimensions={[]}
			initial={panel()}
			initialTimeframe="last30days"
			renderedAt={RENDERED_AT}
			liveVisitors={false}
			metrics={['pageviews']}
			{...over}
		/>
	)

const pick = (preset: string) =>
	fireEvent.change(screen.getByLabelText(keys.widgetFieldRange), { target: { value: preset } })

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('AnalyticsPanelClient', () => {
	// The server's markup and the browser's first paint mark the same bucket, whatever the
	// browser's own clock says by the time it hydrates.
	it("marks the counting bucket by the server's render, not the browser's clock", () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		)
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(new Date('2026-06-03T09:00:00.000Z'))
		try {
			const countingRow = (renderedAt: string): HTMLTableRowElement | null => {
				renderPanel({ renderedAt })
				const row = screen.getByText(keys.chartSoFar).closest('tr')
				const first = row?.parentElement?.firstElementChild === row
				cleanup()
				return first ? row : null
			}
			expect(countingRow('2026-06-01T12:00:00.000Z')).not.toBeNull()
			expect(countingRow(RENDERED_AT)).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps the caption on the window the numbers were read for until the answer lands', async () => {
		let settle: ((res: Response) => void) | undefined
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => (settle = resolve)))
		)
		const { container } = renderPanel()
		pick('last7days')
		expect(container.textContent).toContain(keys.timeframeLast30Days)
		await act(async () => {
			settle?.(answer(panel({ metrics: { pageviews: 9 } })))
		})
		expect(container.textContent).toContain(keys.timeframeLast7Days)
	})

	it('drops a superseded read rather than letting it land last', async () => {
		const pending: ((res: Response) => void)[] = []
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)))
		)
		renderPanel()
		pick('last7days')
		pick('today')
		expect(pending).toHaveLength(2)
		await act(async () => {
			// The superseded request answers last: it was aborted when the second was issued,
			// so its answer is ignored rather than overwriting the newer one.
			pending[1]?.(answer(panel({ metrics: { pageviews: 222 }, seriesGranularity: 'hour' })))
			pending[0]?.(answer(panel({ metrics: { pageviews: 111 } })))
		})
		expect(screen.getByText('222')).toBeDefined()
		expect(screen.queryByText('111')).toBeNull()
	})

	// The panel says what the analytics view says, in the order the view says it.
	it('labels the window picker Date range and puts Data source before it', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		)
		const { container } = renderPanel({
			sources: [
				{ id: 'native', label: 'Native' },
				{ id: 'memory', label: 'Memory' },
			],
		})
		const labels = [
			...container.querySelectorAll<HTMLSelectElement>('.analytics-panel__controls select'),
		].map((select) => select.labels?.[0]?.textContent)
		expect(labels).toEqual([keys.viewSourceLabel, keys.widgetFieldRange])
		expect(screen.queryByLabelText(keys.widgetFieldTimeframe)).toBeNull()
	})

	it("drops the last source's numbers the moment another source is picked", async () => {
		const pending: ((res: Response) => void)[] = []
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)))
		)
		renderPanel({
			initialSourceId: 'native',
			sources: [
				{ id: 'native', label: 'Native' },
				{ id: 'plausible', label: 'Plausible' },
			],
		})
		expect(screen.getByText('120')).toBeDefined()
		fireEvent.change(screen.getByLabelText(keys.viewSourceLabel), {
			target: { value: 'plausible' },
		})
		expect(screen.queryByText('120')).toBeNull()
		expect(screen.getAllByTestId('shimmer').length).toBeGreaterThan(0)

		await act(async () => {
			pending[0]?.(new Response(null, { status: 503 }))
		})
		expect(screen.queryByText('120')).toBeNull()
		expect(screen.getByText(keys.viewErrorBusy)).toBeDefined()
	})

	it('offers only the date range when the page has one source', () => {
		const { container } = renderPanel()
		const labels = [
			...container.querySelectorAll<HTMLSelectElement>('.analytics-panel__controls select'),
		].map((select) => select.labels?.[0]?.textContent)
		expect(labels).toEqual([keys.widgetFieldRange])
	})

	it('puts the live indicator after the controls, as a dot and a count', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ status: 'ok', activeNow: 1 }),
				} as Response)
			)
		)
		const { container } = renderPanel({ initial: panel({ realtime: true }), liveVisitors: true })
		await act(async () => {})
		const toolbar = container.querySelector('.analytics-panel__toolbar')
		expect(toolbar?.lastElementChild?.className).toBe('analytics-live analytics-panel__live')
		// The stub `t` answers with the key, so the phrase is the count beside its form's key.
		expect(toolbar?.lastElementChild?.textContent).toBe(`1${pluralKeys.liveVisitors.other}`)
	})

	// A page nobody viewed has no average time and no scroll depth: "0s" and "0%" would read as
	// a visit measured at zero.
	it('shows a dash and no delta for an average with no samples', () => {
		const { container } = renderPanel({
			initial: panel({
				// Visitors who only converted: people on the page, and no pageview to time.
				metrics: { pageviews: 0, visitors: 3, avgDuration: null, scrollDepth: null },
				supportedMetrics: ['pageviews', 'visitors', 'avgDuration', 'scrollDepth'],
				previousMetrics: { pageviews: 0, visitors: 3, avgDuration: 2000, scrollDepth: null },
				comparisonRange: {
					start: '2026-05-01T00:00:00.000Z',
					end: '2026-05-31T00:00:00.000Z',
				},
				points: [day('2026-06-01', 0)],
			}),
			metrics: ['pageviews', 'visitors', 'avgDuration', 'scrollDepth'],
		})
		expect(screen.getAllByText('-')).toHaveLength(2)
		// Pageviews and visitors compare; the two averages draw no delta at all.
		expect(container.querySelectorAll('span[role="img"]')).toHaveLength(2)
		expect(container.textContent).not.toContain('0s')
	})

	it('names visitors the read added up day by day as such, unless the developer named the card', () => {
		const summed: Partial<AnalyticsPanelClientProps> = {
			initial: panel({
				metrics: { pageviews: 120, visitors: 40 },
				supportedMetrics: ['pageviews', 'visitors'],
				notices: { ...mergeNotices(), visitorsSummed: true },
			}),
			metrics: ['pageviews', 'visitors'],
		}
		renderPanel(summed)
		expect(screen.getByText(keys.metricVisitorsSummed)).toBeDefined()
		cleanup()
		renderPanel({ ...summed, labels: { visitors: 'People' } })
		expect(screen.getByText('People')).toBeDefined()
		expect(screen.queryByText(keys.metricVisitorsSummed)).toBeNull()
	})

	it('draws no chart for an hourly window a source serves only by day', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(answer(panel({ seriesGranularity: 'day' }))))
		)
		const { container } = renderPanel()
		expect(container.querySelector('.analytics-chart')).not.toBeNull()
		await act(async () => {
			pick('today')
		})
		expect(container.querySelector('.analytics-chart')).toBeNull()
		expect(screen.getByText('120')).toBeDefined()
	})

	it('says once, under everything, what the totals and the lists say about their numbers', () => {
		const { container } = renderPanel({
			dimensions: ['country'],
			initial: panel({
				notices: {
					clamped: false,
					stale: false,
					sourceError: false,
					hostRefused: false,
					filtersUnapplied: false,
					goalsUnresolved: false,
					sampled: false,
					partial: true,
					capped: false,
					timezoneUnresolved: false,
					mixedCurrencies: [],
				},
				breakdowns: [
					{
						dimension: 'country',
						metric: 'visitors',
						rows: [{ value: 'DE', metric: 4 }],
						partial: true,
						capped: true,
					},
				],
			}),
		})
		expect(container.textContent?.split(keys.statePartial)).toHaveLength(2)
		expect(screen.getByText(`${keys.statePartial} · ${keys.stateCapped}`)).toBeDefined()
	})
})

describe('AnalyticsPanelClient seeded by the server', () => {
	const renderSeeded = (seed: PanelSeed, initial?: PanelData) => renderPanel({ seed, initial })

	const urlOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0): URL =>
		new URL(String(fetchMock.mock.calls[call]?.[0]), 'http://localhost')

	it('reads nothing when the seed is fresh', () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		renderSeeded('fresh', panel())
		expect(screen.getByText('120')).toBeDefined()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('shows a shimmer and reads once it mounts when there is no seed', async () => {
		let settle: ((res: Response) => void) | undefined
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (settle = resolve)))
		vi.stubGlobal('fetch', fetchMock)
		renderSeeded('missing')
		expect(screen.getAllByTestId('shimmer').length).toBeGreaterThan(0)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(urlOf(fetchMock).searchParams.get('fresh')).toBeNull()
		expect(urlOf(fetchMock).searchParams.get('timeframe')).toBe('last30days')
		await act(async () => {
			settle?.(answer(panel({ metrics: { pageviews: 77 } })))
		})
		expect(screen.queryByTestId('shimmer')).toBeNull()
		expect(screen.getByText('77')).toBeDefined()
	})

	it('says a busy source is busy, in a banner with when to retry and a retry, never unavailable', async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				Response.json(
					{ error: { code: 'unavailable', message: 'busy' } },
					{ status: 503, headers: { 'Retry-After': '30' } }
				)
			)
		)
		vi.stubGlobal('fetch', fetchMock)
		const { container } = renderSeeded('missing')
		await act(async () => {})
		expect(screen.queryByTestId('shimmer')).toBeNull()
		expect(screen.getByRole('alert').textContent).toBe(keys.viewErrorBusy)
		expect(container.textContent).toContain(keys.viewErrorRetryAfter)
		expect(container.textContent).not.toContain(keys.stateUnavailable)
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: keys.viewRetry }))
		})
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('keeps the numbers that answered and offers a retry for the parts that did not', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(Response.json(panel({ metrics: { pageviews: 77 }, incomplete: true })))
			)
		)
		const { container } = renderSeeded('missing')
		await act(async () => {})
		expect(screen.getByText('77')).toBeDefined()
		expect(container.textContent).toContain(keys.statePartsFailed)
		expect(screen.getByRole('button', { name: keys.viewRetry })).toBeDefined()
	})

	it('says the reader has no access when the endpoint refuses them, rather than an outage', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					Response.json({ error: { code: 'forbidden', message: 'denied' } }, { status: 403 })
				)
			)
		)
		const { container } = renderSeeded('missing')
		await act(async () => {})
		expect(container.textContent).toContain(keys.stateNoAccess)
		expect(container.textContent).not.toContain(keys.stateUnavailable)
	})

	it('shows a stale seed at once and reads it again from its source', async () => {
		let settle: ((res: Response) => void) | undefined
		const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (settle = resolve)))
		vi.stubGlobal('fetch', fetchMock)
		renderSeeded('stale', panel())
		expect(screen.getByText('120')).toBeDefined()
		expect(urlOf(fetchMock).searchParams.get('fresh')).toBe('1')
		await act(async () => {
			settle?.(answer(panel({ metrics: { pageviews: 9 } })))
		})
		expect(screen.getByText('9')).toBeDefined()
	})

	it('keeps a stale seed when reading it again fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('offline')))
		)
		const { container } = renderSeeded('stale', panel())
		await act(async () => {})
		expect(screen.getByText('120')).toBeDefined()
		expect(container.textContent).not.toContain(keys.stateUnavailable)
	})
})

describe('AnalyticsPanelClient with nothing counted', () => {
	const WINDOW = { start: '2026-05-04T00:00:00.000Z', end: '2026-06-02T23:59:59.999Z' }
	const BEFORE_WINDOW = '2026-01-10T08:00:00.000Z'
	const INSIDE_WINDOW = '2026-05-20T08:00:00.000Z'

	const nothing = (over: Partial<PanelData> = {}): PanelData =>
		panel({
			metrics: { pageviews: 0, visitors: 0 },
			supportedMetrics: ['pageviews', 'visitors'],
			points: [day('2026-06-01', 0), day('2026-06-02', 0)],
			dateRange: WINDOW,
			...over,
		})

	const renderNothing = (initial: PanelData, over: Partial<AnalyticsPanelClientProps> = {}) =>
		renderPanel({ initial, metrics: ['pageviews', 'visitors'], ...over })

	it('says an older page had no visits in the range, in place of zero cards and a flat chart', () => {
		const { container } = renderNothing(nothing(), { createdAt: BEFORE_WINDOW })
		expect(screen.getByText(keys.panelNoVisits)).toBeDefined()
		expect(screen.queryByText(keys.stateNew)).toBeNull()
		expect(container.querySelector('.analytics-metric')).toBeNull()
		expect(container.querySelector('.analytics-chart')).toBeNull()
		expect(screen.getByLabelText(keys.widgetFieldRange)).toBeDefined()
	})

	it('keeps a note that bears on the empty range and drops one about cards it does not draw', () => {
		const { container } = renderNothing(
			nothing({ notices: { ...mergeNotices(), partial: true, visitorsSummed: true } }),
			{ createdAt: BEFORE_WINDOW }
		)
		const note = container.querySelector('.analytics-panel__notice')?.textContent
		expect(note).toBe(keys.statePartial)
	})

	it('reads a page without timestamps as one with no visits, not as new', () => {
		renderNothing(nothing())
		expect(screen.getByText(keys.panelNoVisits)).toBeDefined()
		expect(screen.queryByText(keys.stateNew)).toBeNull()
	})

	it('keeps the live counter beside the range select', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ status: 'ok', activeNow: 0 }),
				} as Response)
			)
		)
		const { container } = renderNothing(nothing({ realtime: true }), {
			createdAt: BEFORE_WINDOW,
			liveVisitors: true,
		})
		await act(async () => {})
		expect(screen.getByText(keys.panelNoVisits)).toBeDefined()
		const toolbar = container.querySelector('.analytics-panel__toolbar')
		expect(toolbar?.lastElementChild?.className).toBe('analytics-live analytics-panel__live')
	})

	it('shows the numbers once the editor widens the range to days that had visits', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(answer(panel({ metrics: { pageviews: 40 }, dateRange: WINDOW }))))
		)
		renderNothing(nothing(), { createdAt: BEFORE_WINDOW })
		await act(async () => {
			pick('last90days')
		})
		expect(screen.getByText('40')).toBeDefined()
		expect(screen.queryByText(keys.panelNoVisits)).toBeNull()
	})

	it('says when numbers will come for a page created inside the range', () => {
		const { container } = renderNothing(nothing(), { createdAt: INSIDE_WINDOW })
		const empty = container.querySelector('.analytics-panel__empty')
		expect(empty?.querySelector('.analytics-empty-state--new')?.textContent).toBe(keys.stateNew)
		expect(empty?.textContent).toContain(keys.panelNewPage)
		expect(container.querySelector('.analytics-metric')).toBeNull()
		expect(screen.queryByText(keys.panelNoVisits)).toBeNull()
	})

	it('says the same for a document that has no path yet', () => {
		renderNothing({ status: 'no-path', metrics: {}, supportedMetrics: [], dateRange: WINDOW })
		expect(screen.getByText(keys.stateNew)).toBeDefined()
		expect(screen.getByText(keys.panelNewPage)).toBeDefined()
	})
})

describe('AnalyticsPanelClient accessibility', () => {
	it('has no structural violations, its lists tables and its live count no live region', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ status: 'ok', activeNow: 2 }),
				} as Response)
			)
		)
		const { container } = renderPanel({
			dimensions: ['country', 'device'],
			initial: panel({
				realtime: true,
				metrics: { pageviews: 120, visitors: 40 },
				supportedMetrics: ['pageviews', 'visitors'],
				previousMetrics: { pageviews: 100, visitors: 50 },
				comparisonRange: { start: '2026-05-01T00:00:00.000Z', end: '2026-05-31T00:00:00.000Z' },
				breakdowns: [
					{ dimension: 'country', metric: 'visitors', rows: [{ value: 'DE', metric: 4 }] },
					{ dimension: 'device', metric: 'visitors', rows: [{ value: 'mobile', metric: 3 }] },
				],
			}),
			liveVisitors: true,
			metrics: ['pageviews', 'visitors'],
		})
		await act(async () => {})
		expect(a11yViolations(container)).toEqual([])
		const named = screen
			.getAllByRole('table')
			.map(
				(table) => table.getAttribute('aria-label') ?? table.querySelector('caption')?.textContent
			)
		// The chart's hidden data table, then the two lists.
		expect(named).toEqual([keys.chartLabel, keys.viewDimensionCountry, keys.viewDimensionDevice])
		const country = screen.getByRole('table', { name: keys.viewDimensionCountry })
		expect(country.querySelector('thead')?.className).toBe('analytics-sr-only')
		expect(country.querySelector('tbody th[scope="row"]')).not.toBeNull()
		const live = container.querySelector('.analytics-panel__live')
		expect(live?.hasAttribute('aria-live')).toBe(false)
		expect(live?.querySelectorAll('.analytics-sr-only[aria-live="polite"]')).toHaveLength(1)
	})
})
