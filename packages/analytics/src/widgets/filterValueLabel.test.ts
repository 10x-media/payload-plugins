import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsFilter } from '../core/contract'
import { en } from '../translations/en'
import { filterValueLabel } from './filterValueLabel'

const mocks = vi.hoisted(() => ({
	goals: vi.fn(),
	items: vi.fn(),
}))

vi.mock('../plugin/runtime', () => ({
	getRuntime: () => ({}),
	resolveGoalsFor: mocks.goals,
}))

vi.mock('../plugin/itemLabels', () => ({
	resolveItemLabels: mocks.items,
}))

const strings: Record<string, string> = en

const req = (language = 'en'): PayloadRequest =>
	({
		payload: {},
		i18n: { language, t: (key: string) => strings[key] ?? key },
	}) as unknown as PayloadRequest

const filter = (dimension: AnalyticsFilter['dimension'], value: string): AnalyticsFilter => ({
	dimension,
	operator: 'eq',
	value,
})

const native = { provider: 'native' }

beforeEach(() => {
	mocks.goals.mockReset()
	mocks.items.mockReset()
})

describe('filterValueLabel', () => {
	it('names a country in the admin language', async () => {
		expect(await filterValueLabel(req(), filter('country', 'DE'), native)).toBe('Germany')
		expect(await filterValueLabel(req('de'), filter('country', 'DE'), native)).toBe('Deutschland')
	})

	it('names a browser and a device by their labels for any source', async () => {
		expect(
			await filterValueLabel(req(), filter('browser', 'chrome'), { provider: 'plausible' })
		).toBe('Chrome')
		expect(await filterValueLabel(req(), filter('device', 'mobile'), { provider: 'ga4' })).toBe(
			'Mobile'
		)
	})

	it("names a channel only where the source is native, as the view's chip does", async () => {
		expect(await filterValueLabel(req(), filter('channel', 'organic-search'), native)).toBe(
			'Organic search'
		)
		expect(
			await filterValueLabel(req(), filter('channel', 'organic-search'), { provider: 'posthog' })
		).toBe('organic-search')
	})

	it("names a goal by the read's goals, or else the scope's", async () => {
		const goals = [{ slug: 'book-demo', name: 'Book a demo' }]
		expect(await filterValueLabel(req(), filter('goal', 'book-demo'), { ...native, goals })).toBe(
			'Book a demo'
		)
		mocks.goals.mockResolvedValue([{ slug: 'newsletter', name: 'Newsletter signup' }])
		expect(await filterValueLabel(req(), filter('goal', 'newsletter'), native)).toBe(
			'Newsletter signup'
		)
	})

	it('names an item by its title, and keeps the ref when the titles cannot be read', async () => {
		mocks.items.mockResolvedValue({ 'offers:12': 'Summer sale' })
		expect(await filterValueLabel(req(), filter('item', 'offers:12'), native)).toBe('Summer sale')
		mocks.items.mockRejectedValue(new Error('down'))
		expect(await filterValueLabel(req(), filter('item', 'offers:12'), native)).toBe('offers:12')
	})

	it('keeps the stored value on a request with no words to label with', async () => {
		const bare = { payload: {} } as unknown as PayloadRequest
		expect(await filterValueLabel(bare, filter('country', 'DE'), native)).toBe('DE')
	})
})
