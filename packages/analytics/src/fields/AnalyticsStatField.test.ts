import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsResult } from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { renderSettled } from '../testing/renderSettled'
import { keys } from '../translations/keys'
import { AnalyticsStatField, type AnalyticsStatFieldProps } from './AnalyticsStatField'

const answering = (meta: Partial<AnalyticsResult['meta']>): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: memoryAdapter().capabilities,
	isConfigured: () => true,
	query: async () => ({
		rows: [],
		totals: { pageviews: 12 },
		meta: { provider: 'native', fetchedAt: '', ...meta },
	}),
})

const reqFor = (
	adapter: AnalyticsAdapter,
	keep?: (work: Promise<unknown>) => void
): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: { pages: { pathField: 'slug', scopeField: false } },
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}), ...(keep ? { keep } : {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
	})
	return { payload } as PayloadRequest
}

/** A row of one pageviews stat for `/pricing` over the last week; `over` replaces any prop. */
const renderRow = (req: PayloadRequest, over: Partial<AnalyticsStatFieldProps> = {}) =>
	renderSettled(
		AnalyticsStatField({
			req,
			data: { slug: '/pricing' },
			collectionSlug: 'pages',
			i18n: { t: (key: string) => key, language: 'en' },
			metrics: ['pageviews'],
			timeframe: 'last7days',
			variant: 'row',
			...over,
		})
	)

const render = (
	adapter: AnalyticsAdapter,
	budgetMs?: number,
	keep?: (work: Promise<unknown>) => void
): Promise<string> => renderRow(reqFor(adapter, keep), budgetMs === undefined ? {} : { budgetMs })

/** A row of one stat for a document of `data`, read from a source that counted nothing. */
const renderEmpty = (data: Record<string, unknown>): Promise<string> =>
	renderRow(
		reqFor({
			...answering({}),
			query: async () => ({
				rows: [],
				totals: { pageviews: 0 },
				meta: { provider: 'native', fetchedAt: '' },
			}),
		}),
		{ data }
	)

/** A source that answers only once the test lets it, counting the reads it was asked for. */
const held = () => {
	let release: (() => void) | undefined
	const answered = new Promise<void>((resolve) => {
		release = resolve
	})
	let asked = 0
	let finished = 0
	const adapter: AnalyticsAdapter = {
		...answering({}),
		query: async () => {
			asked += 1
			await answered
			finished += 1
			return { rows: [], totals: { pageviews: 12 }, meta: { provider: 'native', fetchedAt: '' } }
		},
	}
	return {
		adapter,
		release: () => release?.(),
		reads: () => ({ asked, finished }),
	}
}

describe('AnalyticsStatField', () => {
	it('says under the numbers that some days are still being counted', async () => {
		const html = await render(answering({ partial: { missingDays: 2 } }))
		expect(html).toContain('12')
		expect(html).toContain(keys.statePartial)
	})

	it('says nothing more for a read counted in full', async () => {
		const html = await render(answering({}))
		expect(html).not.toContain(keys.statePartial)
		expect(html).not.toContain(keys.stateCapped)
	})

	it('says it is still loading once the read outlasts its budget, and lets the page finish', async () => {
		const source = held()
		const keep = vi.fn()
		const html = await render(source.adapter, 20, keep)
		expect(html).toContain(keys.stateRefreshing)
		expect(html).not.toContain('12')
		// The read was asked for and runs on past the response, so the next load finds it answered.
		expect(source.reads()).toEqual({ asked: 1, finished: 0 })
		expect(keep).toHaveBeenCalledTimes(1)
		expect(keep.mock.calls[0]?.[0]).toBeInstanceOf(Promise)
		source.release()
		await vi.waitFor(() => expect(source.reads().finished).toBe(1))
	})

	it('shows the New pill for a document with no path yet', async () => {
		const html = await renderEmpty({})
		expect(html).toContain(keys.stateNew)
		expect(html).toContain('analytics-empty-state--new')
		expect(html).not.toContain('analytics-metric__value')
	})

	it('shows the New pill for a document created inside the window that counted nothing', async () => {
		const html = await renderEmpty({ slug: '/fresh', createdAt: new Date().toISOString() })
		expect(html).toContain(keys.stateNew)
		expect(html).not.toContain('analytics-metric__value')
	})

	it('shows the real zeros of an older document nobody visited in the window', async () => {
		const html = await renderEmpty({ slug: '/quiet', createdAt: '2020-01-01T00:00:00.000Z' })
		expect(html).not.toContain(keys.stateNew)
		expect(html).toContain('<span class="analytics-metric__value">0</span>')
		expect(html).toContain(keys.metricPageviews)
	})

	it('shows zeros rather than New where the collection keeps no timestamps', async () => {
		const html = await renderEmpty({ slug: '/untimed' })
		expect(html).not.toContain(keys.stateNew)
		expect(html).toContain('<span class="analytics-metric__value">0</span>')
	})

	it('shows the numbers of a read that answers within its budget', async () => {
		const source = held()
		source.release()
		const keep = vi.fn()
		const html = await render(source.adapter, 2_000, keep)
		expect(html).toContain('12')
		expect(html).not.toContain(keys.stateRefreshing)
		expect(keep).not.toHaveBeenCalled()
	})
})
