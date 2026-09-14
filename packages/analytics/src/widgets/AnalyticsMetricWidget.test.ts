import type { Payload, PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import AnalyticsMetricWidget from './AnalyticsMetricWidget'
import type { MetricWidgetData } from './types'
import type { WidgetView } from './viewLink'

const unconfigured = {
	id: 'test',
	label: 'Test',
	capabilities: { metrics: new Set(['pageviews']) },
	isConfigured: () => false,
} as unknown as AnalyticsAdapter

const bootFakeRuntime = () => {
	const resolveScope = vi.fn(() => Promise.resolve(null))
	const resolveTimezone = vi.fn(() => Promise.resolve('Europe/Berlin'))
	const payload = {
		logger: { warn: () => {} },
		config: { routes: { admin: '/admin' } },
	} as unknown as Payload
	setRuntime(payload, {
		registry: { default: () => unconfigured, get: () => unconfigured },
		configAdapterIds: new Set<string>(),
		bindings: {},
		ttl: {},
		comparison: false,
		resolveScope,
		resolveTimezone,
	} as unknown as AnalyticsRuntime)
	const req = {
		payload,
		i18n: { t: (key: string) => key, language: 'en' },
	} as unknown as PayloadRequest
	return { req, resolveScope, resolveTimezone }
}

const render = (req: PayloadRequest, widgetData: MetricWidgetData, view?: WidgetView) =>
	AnalyticsMetricWidget({ req, widgetData, view } as unknown as WidgetServerProps)

const renderHtml = async (
	req: PayloadRequest,
	widgetData: MetricWidgetData,
	view?: WidgetView
): Promise<string> => renderToStaticMarkup(await render(req, widgetData, view))

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

describe('AnalyticsMetricWidget', () => {
	it('resolves the reporting timezone once, inside the read, for a preset timeframe', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await render(req, { metric: 'pageviews', timeframe: 'last30days' })
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('resolves it up front for a custom range, so the window is read in it', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await render(req, {
			metric: 'pageviews',
			timeframe: 'custom',
			range: { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' },
		})
		// Once for the range and caption, once for the read's own scope resolution.
		expect(resolveScope).toHaveBeenCalledTimes(2)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('links into the view on its own metric, window and source', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(
			req,
			{ metric: 'visitors', timeframe: 'last7days', dataSource: 'plausible' },
			{ path: '/analytics' }
		)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe('/admin/analytics?range=last7days&source=plausible&metric=visitors')
	})

	it('spells a custom window as days in the reporting timezone', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'custom',
				range: { from: '2026-06-01', to: '2026-06-22' },
			},
			{ path: '/analytics' }
		)
		expect(hrefIn(html)).toBe('/admin/analytics?range=custom&from=2026-06-01&to=2026-06-22')
	})

	it('renders no link when the app turned the view off', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(req, { metric: 'pageviews' }, false)
		expect(html).not.toContain('analytics-widget__link')
		expect(html).not.toContain('analytics:widgetOpenInView')
	})
})
