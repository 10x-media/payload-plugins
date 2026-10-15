import type { PayloadRequest, WidgetServerProps } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSettled } from '../testing/renderSettled'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import AnalyticsRealtimeWidget from './AnalyticsRealtimeWidget'
import { readForWidgetRealtime, type WidgetRealtimeResult } from './readForWidgetRealtime'
import type { WidgetView } from './viewLink'
import { hrefIn, TEST_VIEW as view } from './widgetTestKit'

vi.mock('./readForWidgetRealtime', () => ({ readForWidgetRealtime: vi.fn() }))

// The live counter is a client component, which reads the admin's strings from Payload's provider.
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		i18n: { language: 'en', translations: { analytics: en } },
		t: (key: string, vars?: Record<string, string>) =>
			(Reflect.get(en, key) ?? key).replace('{{count}}', vars?.count ?? ''),
	}),
}))

const result = (over: Partial<WidgetRealtimeResult> = {}): WidgetRealtimeResult => ({
	status: 'ok',
	adapterId: 'native',
	activeNow: 7,
	series: [{ date: '2026-06-03T12:00:00.000Z', value: 7 }],
	...over,
})

/** Every key stands in for itself, bar the window caption, which fills its `{{duration}}`. */
const fakeT = (key: string, vars?: Record<string, string | number>): string =>
	key === keys.widgetRealtimeWindow
		? en[keys.widgetRealtimeWindow].replace('{{duration}}', String(vars?.duration))
		: key

const req = (): PayloadRequest =>
	({
		payload: {
			config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://example.com' },
		} as unknown as PayloadRequest['payload'],
		i18n: { t: fakeT, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (
	widgetData: Record<string, unknown> = {},
	view?: WidgetView
): Promise<string> =>
	renderSettled(
		AnalyticsRealtimeWidget({ req: req(), widgetData, view } as unknown as WidgetServerProps)
	)

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

describe('AnalyticsRealtimeWidget card', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetRealtime).mockReset()
		vi.mocked(readForWidgetRealtime).mockResolvedValue(result())
	})

	it('names its rolling window on the title line', async () => {
		const html = await render({ windowMinutes: '15' }, view)
		const header = /<div class="analytics-widget__header"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? ''
		expect(header).toContain('analytics:widgetRealtimeLabel')
		expect(header).toContain('Last 15 minutes')
	})

	it('says what the number counts beside it, and lets the sparkline fill the card', async () => {
		const html = await render({}, view)
		const row = /<div class="analytics-widget__value-row"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? ''
		expect(row).toContain('>7<')
		expect(row).toContain('>visitors active right now<')
		expect(html).toContain('class="analytics-chart analytics-chart--trend analytics-chart--fill"')
	})

	it('notes a saved source it could no longer read, counting the default instead', async () => {
		vi.mocked(readForWidgetRealtime).mockResolvedValueOnce(
			result({ substitutedFrom: 'posthog:65f0c2a9e1' })
		)
		const html = await render({ dataSource: 'posthog:65f0c2a9e1' }, view)
		expect(html).toContain('>7<')
		expect(html).toContain(`>${keys.stateSourceSubstituted}<`)
		expect(html).not.toContain('posthog:65f0c2a9e1')
		expect(await render({}, view)).not.toContain(keys.stateSourceSubstituted)
	})

	it('centers the message and leaves the window out when the source cannot count', async () => {
		vi.mocked(readForWidgetRealtime).mockResolvedValue(result({ status: 'unavailable' }))
		const html = await render({}, view)
		expect(html).toContain('class="analytics-widget__empty"')
		expect(html).not.toContain('analytics-widget__caption')
	})
})
