import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { AnalyticsStatField } from '../../src/fields/AnalyticsStatField'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { renderSettled } from '../../src/testing/renderSettled'
import { ingestDirect } from './nativeHelpers'
import { readerRequest } from './readerRequest'

type StatFieldProps = Parameters<typeof AnalyticsStatField>[0]

const i18nStub = { t: (key: string) => key, language: 'en' }

/**
 * These specs assert numbers, so a cold native read on a busy test machine gets all the time it
 * needs; the 2 second budget has its own unit spec.
 */
const READ_BUDGET_MS = 60_000

describeForDb('analytics stat field render', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = (path: string) =>
		ingestDirect(
			booted.payload,
			{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
			{ 'x-vercel-ip-country': 'US' }
		)

	/** The field's markup for a `pages` document over the last 30 days. */
	const render = (props: Pick<StatFieldProps, 'data' | 'metrics' | 'variant' | 'labels'>) =>
		renderSettled(
			AnalyticsStatField({
				req: readerRequest(booted.payload, { locale: undefined }),
				budgetMs: READ_BUDGET_MS,
				collectionSlug: 'pages',
				i18n: i18nStub,
				timeframe: 'last30days',
				...props,
			})
		)

	it('renders the resolved pageview count and metric label', async () => {
		await ingest('/render')
		await ingest('/render')
		const html = await render({
			data: { slug: '/render' },
			metrics: ['pageviews'],
			variant: 'stat',
		})
		expect(html).toContain('2')
		expect(html).toContain('analytics:metricPageviews')
	})

	it('renders the New state for an unsaved document', async () => {
		const html = await render({ data: {}, metrics: ['pageviews'], variant: 'stat' })
		expect(html).toContain('analytics:stateNew')
	})

	it('renders zeros, not the New state, for an older page nobody visited in the window', async () => {
		const html = await render({
			data: { slug: '/never-visited', createdAt: '2020-01-01T00:00:00.000Z' },
			metrics: ['pageviews'],
			variant: 'stat',
		})
		expect(html).not.toContain('analytics:stateNew')
		expect(html).toContain('analytics:metricPageviews')
		expect(html).toContain('<span class="analytics-metric__value">0</span>')
	})

	it('renders the supported subset when some metrics are unsupported', async () => {
		await ingest('/mixed')
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const html = await render({
			data: { slug: '/mixed' },
			metrics: ['pageviews', 'revenue'],
			variant: 'row',
		})
		expect(html).toContain('analytics:metricPageviews')
		expect(html).not.toContain('analytics:metricRevenue')
		expect(html).not.toContain('analytics:stateUnavailable')
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('revenue'))
		warn.mockRestore()
	})

	it('renders label overrides in place of translated metric names', async () => {
		await ingest('/labelled')
		const html = await render({
			data: { slug: '/labelled' },
			metrics: ['pageviews', 'visitors'],
			variant: 'row',
			labels: {
				pageviews: 'Views',
				visitors: ({ t }) =>
					`${(t as unknown as (key: string) => string)('analytics:metricVisitors')}!`,
			},
		})
		expect(html).toContain('Views')
		expect(html).not.toContain('analytics:metricPageviews')
		expect(html).toContain('analytics:metricVisitors!')
	})

	it('renders the unavailable state only when no metric is supported', async () => {
		const html = await render({
			data: { slug: '/mixed' },
			metrics: ['revenue', 'impressions'],
			variant: 'row',
		})
		expect(html).toContain('analytics:stateUnavailable')
	})
})
