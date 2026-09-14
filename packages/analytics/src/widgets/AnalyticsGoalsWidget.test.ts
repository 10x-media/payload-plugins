import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsGoalsWidget from './AnalyticsGoalsWidget'
import { readForWidgetGoals, type WidgetGoalsResult } from './readForWidgetGoals'
import type { GoalsWidgetData } from './types'

vi.mock('./readForWidgetGoals', () => ({ readForWidgetGoals: vi.fn() }))

const NOW = new Date('2026-06-03T12:00:00.000Z')

const result = (over: Partial<WidgetGoalsResult> = {}): WidgetGoalsResult => ({
	status: 'ok',
	adapterId: 'native',
	dateRange: { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW },
	timezone: 'UTC',
	rows: [
		{ slug: 'newsletter', name: 'Newsletter', conversions: 9, revenue: 0, rate: 0.083 },
		{ slug: 'purchase', name: 'Purchase', conversions: 5, revenue: 250, rate: 0.04 },
	],
	siteVisitors: 108,
	...over,
})

const req = (): PayloadRequest =>
	({
		payload: {} as PayloadRequest['payload'],
		i18n: { t: (key: string) => key, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (widgetData: GoalsWidgetData = {}): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsGoalsWidget({ req: req(), widgetData } as unknown as WidgetServerProps)
	)

describe('AnalyticsGoalsWidget', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetGoals).mockReset()
	})

	it('renders one row per goal with its conversions, rate and revenue', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		const html = await render()
		expect(html).toContain('Newsletter')
		expect(html).toContain('Purchase')
		expect(html).toMatch(/>250<\/td>/)
		expect(html).toContain('8.3%')
		expect(html).toContain('analytics:widgetGoalsRate')
		expect(html).toContain('analytics:widgetGoalsRevenue')
	})

	it('reads the row limit and comparison from the widget data', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		await render({ limit: '25', compare: true, dataSource: 'plausible' })
		expect(vi.mocked(readForWidgetGoals).mock.calls[0]?.[0]).toMatchObject({
			limit: 25,
			compare: true,
			adapterId: 'plausible',
		})
	})

	it('falls back to the default limit when the stored value is not an offered one', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		await render({ limit: '7' })
		expect(vi.mocked(readForWidgetGoals).mock.calls[0]?.[0]).toMatchObject({ limit: 10 })
	})

	it('omits the rate column when no row carries a rate', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({
				rows: [{ slug: 'purchase', name: 'Purchase', conversions: 5, revenue: 250 }],
				siteVisitors: undefined,
			})
		)
		const html = await render()
		expect(html).not.toContain('analytics:widgetGoalsRate')
		expect(html).toContain('analytics:widgetGoalsRevenue')
	})

	it('omits the revenue column when the source serves no revenue', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({ rows: [{ slug: 'purchase', name: 'Purchase', conversions: 5, rate: 0.04 }] })
		)
		const html = await render()
		expect(html).not.toContain('analytics:widgetGoalsRevenue')
		expect(html).toContain('analytics:widgetGoalsRate')
	})

	it('shows the period-over-period delta on conversions when the read compared', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({
				rows: [
					{ slug: 'purchase', name: 'Purchase', conversions: 5, previousConversions: 4 },
					{ slug: 'newsletter', name: 'Newsletter', conversions: 9 },
				],
			})
		)
		const html = await render({ compare: true })
		expect(html).toContain('analytics:comparisonVsPrevious')
		// One row compared, one without a baseline: exactly one delta chip.
		expect(html.split('role="img"').length - 1).toBe(1)
	})

	it('renders the empty state when the read returned no goals', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateNoBreakdown')
		expect(html).not.toContain('<table')
	})

	it('renders the not-supported state when the source cannot serve goals', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ status: 'unavailable', rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateUnavailable')
		expect(html).not.toContain('<table')
	})

	it('renders the not-configured state', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ status: 'not-configured', rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateNotConfigured')
	})

	it('badges a stale-served read', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ stale: true }))
		expect(await render()).toContain('analytics:viewStale')
		expect(await render()).not.toContain('analytics:stateClamped')
	})

	it('notes a clamped range', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ clamped: true }))
		expect(await render()).toContain('analytics:stateClamped')
	})

	it('captions the timeframe and titles the card', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		expect(await render()).toContain('analytics:timeframeLast30Days')
		expect(await render()).toContain('analytics:widgetGoals')
		expect(await render({ title: 'Signups' })).toContain('Signups')
	})
})
