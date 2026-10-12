import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import {
	AnalyticsPanelClient,
	type AnalyticsPanelClientProps,
	type PanelData,
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
	useDocumentInfo: () => ({ id: 'offer-1' }),
	useTranslation: () => ({
		i18n: { language: 'en-US' },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
}))

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const RENDERED_AT = '2026-06-02T12:00:00.000Z'

const itemPanel = (over: Partial<PanelData> = {}): PanelData => ({
	status: 'ok',
	report: 'item',
	metrics: { impressions: 200, visitors: 150, interactions: 20, conversions: 5 },
	supportedMetrics: ['impressions', 'visitors', 'interactions', 'conversions'],
	timezone: 'UTC',
	points: [
		{ date: '2026-06-01T00:00:00.000Z', value: 120 },
		{ date: '2026-06-02T00:00:00.000Z', value: 80 },
	],
	seriesGranularity: 'day',
	...over,
})

const renderPanel = (over: Partial<AnalyticsPanelClientProps> = {}) =>
	render(
		<AnalyticsPanelClient
			collectionSlug="offers"
			countryFlags={false}
			dimensions={['country', 'source', 'device']}
			initial={itemPanel()}
			initialReport="item"
			initialTimeframe="last30days"
			renderedAt={RENDERED_AT}
			liveVisitors
			metrics={['pageviews', 'visitors']}
			modes={['item']}
			{...over}
		/>
	)

const labels = (container: HTMLElement): string[] =>
	[...container.querySelectorAll<HTMLSelectElement>('.analytics-panel__controls select')].map(
		(select) => select.labels?.[0]?.textContent ?? ''
	)

const requested = (fetchMock: ReturnType<typeof vi.fn>): URLSearchParams => {
	const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? '')
	return new URL(url, 'http://localhost').searchParams
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('the item report', () => {
	it('shows views, viewers, clicks, the click rate, conversions and the rate per view', () => {
		const { container } = renderPanel()
		const cards = new Set<string>([
			keys.metricImpressions,
			keys.itemViewers,
			keys.metricInteractions,
			keys.metricClickRate,
			keys.metricConversions,
			keys.viewConversionRate,
			keys.metricRevenue,
		])
		const cardLabels = [...container.querySelectorAll('span')]
			.map((span) => span.textContent ?? '')
			.filter((text) => cards.has(text))
		expect(cardLabels).toEqual([
			keys.metricImpressions,
			keys.itemViewers,
			keys.metricInteractions,
			keys.metricClickRate,
			keys.metricConversions,
			keys.viewConversionRate,
		])
		expect(screen.getByText('10%')).toBeDefined()
		expect(screen.getByText('2.5%')).toBeDefined()
	})

	it('shows the revenue card only where the source serves money', () => {
		renderPanel({
			initial: itemPanel({
				metrics: { impressions: 200, revenue: 1500 },
				supportedMetrics: ['impressions', 'revenue'],
			}),
		})
		expect(screen.getByText(keys.metricRevenue)).toBeDefined()
		expect(screen.queryByText(keys.metricClickRate)).toBeNull()
	})

	it('names each list for what it holds', () => {
		renderPanel({
			initial: itemPanel({
				breakdowns: [
					{ dimension: 'page', metric: 'impressions', rows: [{ value: '/pricing', metric: 9 }] },
					{ dimension: 'country', metric: 'visitors', rows: [{ value: 'DE', metric: 2 }] },
					{ dimension: 'device', metric: 'visitors', rows: [{ value: 'mobile', metric: 2 }] },
				],
			}),
		})
		expect(screen.getByText(keys.itemPagesSeenOn)).toBeDefined()
		expect(screen.getByText(keys.itemClickCountries)).toBeDefined()
		expect(screen.getByText(keys.itemClickDevices)).toBeDefined()
		expect(screen.getByText('/pricing')).toBeDefined()
	})

	// A source that cannot tell the people who clicked from those who only saw it ranks clicks.
	it('names a list read as clicks for its clicks, not for the people behind them', () => {
		renderPanel({
			initial: itemPanel({
				breakdowns: [
					{ dimension: 'country', metric: 'interactions', rows: [{ value: 'DE', metric: 4 }] },
					{ dimension: 'device', metric: 'interactions', rows: [{ value: 'mobile', metric: 4 }] },
				],
			}),
		})
		expect(screen.getByText(keys.itemClicksByCountry)).toBeDefined()
		expect(screen.getByText(keys.itemClicksByDevice)).toBeDefined()
		expect(screen.queryByText(keys.itemClickCountries)).toBeNull()
	})

	it('says an older item had no views in the range rather than drawing zero cards', () => {
		const { container } = renderPanel({
			createdAt: '2026-01-10T08:00:00.000Z',
			initial: itemPanel({
				metrics: { impressions: 0, visitors: 0, interactions: 0, conversions: 0 },
				points: [],
				dateRange: { start: '2026-05-04T00:00:00.000Z', end: '2026-06-02T23:59:59.999Z' },
			}),
		})
		expect(screen.getByText(keys.panelNoViews)).toBeDefined()
		expect(screen.queryByText(keys.panelNoVisits)).toBeNull()
		expect(container.querySelector('.analytics-metric')).toBeNull()
	})

	it('says when numbers will come for an item created inside the range', () => {
		renderPanel({
			createdAt: '2026-05-20T08:00:00.000Z',
			initial: itemPanel({
				metrics: { impressions: 0, visitors: 0, interactions: 0, conversions: 0 },
				points: [],
				dateRange: { start: '2026-05-04T00:00:00.000Z', end: '2026-06-02T23:59:59.999Z' },
			}),
		})
		expect(screen.getByText(keys.stateNew)).toBeDefined()
		expect(screen.getByText(keys.panelNewItem)).toBeDefined()
	})

	it('draws no live counter, whatever the source can count live', () => {
		const { container } = renderPanel({ initial: itemPanel({ realtime: true }) })
		expect(container.querySelector('.analytics-panel__live')).toBeNull()
	})

	// A long window is charted by week, so the name says views rather than views per day.
	it('names its trend by views over the window', () => {
		const { container } = renderPanel()
		const chart = container.querySelector('[role="img"][aria-label]')
		expect(chart?.getAttribute('aria-label')).toBe(
			`${keys.chartLabel} ${JSON.stringify({ metric: keys.metricImpressions, window: keys.timeframeLast30Days })}`
		)
	})
})

describe('a collection bound as both', () => {
	it('offers the switch first, opening on the item', () => {
		const { container } = renderPanel({ modes: ['item', 'page'] })
		expect(labels(container)).toEqual([keys.panelReportLabel, keys.widgetFieldRange])
		const report = screen.getByLabelText(keys.panelReportLabel) as HTMLSelectElement
		expect(report.value).toBe('item')
	})

	it("reads the page report with the page's own metrics when switched", async () => {
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
		vi.stubGlobal('fetch', fetchMock)
		renderPanel({ modes: ['item', 'page'] })
		await act(async () => {
			fireEvent.change(screen.getByLabelText(keys.panelReportLabel), { target: { value: 'page' } })
		})
		const params = requested(fetchMock)
		expect(params.get('report')).toBe('page')
		expect(params.get('metrics')).toBe('pageviews,visitors')
		expect(params.get('dimensions')).toBe('country,source,device')
	})

	it("reads the item's own lists, through a source that can read items, when switched back", async () => {
		const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
		vi.stubGlobal('fetch', fetchMock)
		const { container } = renderPanel({
			modes: ['item', 'page'],
			initial: { ...itemPanel(), report: undefined },
			initialReport: 'page',
			initialSourceId: 'memory',
			sources: [
				{ id: 'native', label: 'Native', perItemQuery: true },
				{ id: 'memory', label: 'Memory' },
			],
		})
		expect(labels(container)).toEqual([
			keys.panelReportLabel,
			keys.viewSourceLabel,
			keys.widgetFieldRange,
		])
		await act(async () => {
			fireEvent.change(screen.getByLabelText(keys.panelReportLabel), { target: { value: 'item' } })
		})
		const params = requested(fetchMock)
		expect(params.get('report')).toBe('item')
		expect(params.get('dataSource')).toBe('native')
		expect(params.get('dimensions')).toBe('page,country,device')
		expect(params.has('metrics')).toBe(false)
		// One source can read items, so the item report offers no source switcher at all.
		expect(labels(container)).toEqual([keys.panelReportLabel, keys.widgetFieldRange])
	})
})
