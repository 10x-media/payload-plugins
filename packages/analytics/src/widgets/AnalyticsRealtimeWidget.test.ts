import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsRealtimeWidget from './AnalyticsRealtimeWidget'
import { readForWidgetRealtime, type WidgetRealtimeResult } from './readForWidgetRealtime'
import type { WidgetView } from './viewLink'

vi.mock('./readForWidgetRealtime', () => ({ readForWidgetRealtime: vi.fn() }))

const result = (over: Partial<WidgetRealtimeResult> = {}): WidgetRealtimeResult => ({
	status: 'ok',
	adapterId: 'native',
	activeNow: 7,
	series: [{ date: '2026-06-03T12:00:00.000Z', value: 7 }],
	...over,
})

const req = (): PayloadRequest =>
	({
		payload: {
			config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://example.com' },
		} as unknown as PayloadRequest['payload'],
		i18n: { t: (key: string) => key, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (
	widgetData: Record<string, unknown> = {},
	view?: WidgetView
): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsRealtimeWidget({ req: req(), widgetData, view } as unknown as WidgetServerProps)
	)

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

const view = { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' } as const

describe('AnalyticsRealtimeWidget view link', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetRealtime).mockReset()
		vi.mocked(readForWidgetRealtime).mockResolvedValue(result())
	})

	it('opens the view on its own default range, naming the adapter that served', async () => {
		vi.mocked(readForWidgetRealtime).mockResolvedValue(result({ adapterId: 'tenant-7' }))
		const html = await render({ dataSource: 'plausible' }, view)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe('/admin/analytics?source=tenant-7')
	})

	it('opens a configured default range without spelling it out', async () => {
		expect(hrefIn(await render({}, { ...view, defaultRange: 'today' }))).toBe(
			'/admin/analytics?source=native'
		)
	})

	it('keeps the link on an unavailable source that resolved no adapter', async () => {
		vi.mocked(readForWidgetRealtime).mockResolvedValue(
			result({ status: 'unavailable', adapterId: '' })
		)
		expect(hrefIn(await render({}, view))).toBe('/admin/analytics')
	})

	it('renders no link when the app turned the view off', async () => {
		expect(await render({}, false)).not.toContain('analytics-widget__link')
	})
})
