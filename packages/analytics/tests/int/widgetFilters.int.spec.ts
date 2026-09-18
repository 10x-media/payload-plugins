import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	DateRange,
} from '../../src/core/contract'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { type BreakdownRow, readForWidgetBreakdown } from '../../src/widgets/readForWidgetBreakdown'

/** Ranking ties are not ordered by the adapter, so compare rows by label. */
const byLabel = (rows: BreakdownRow[]): BreakdownRow[] =>
	[...rows].sort((a, b) => a.label.localeCompare(b.label))

const DAY_MS = 86_400_000
const HOST = 'shop.example'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/125.0 Safari/537.36'

/**
 * Server events stamp themselves with the wall clock, so every read takes an explicit
 * window around the seeding instead of a preset: a day back holds today's rollup bucket
 * whatever the hour, and a minute ahead holds the events just written.
 */
const windowAround = (now: number): DateRange => ({
	start: new Date(now - DAY_MS),
	end: new Date(now + 60_000),
})

interface Seed {
	path: string
	country: string
	ip: string
	tenant?: string
}

/**
 * A pageview through the native adapter's server ingest, attributed from the platform geo
 * headers a hosted deployment sets. Seeding this way rather than writing rows directly is
 * the point of the country cases: `country` has to survive the ingest to be filterable.
 */
const seed = (booted: BootedPayload, event: Seed): Promise<void> =>
	trackServerEvent(
		booted.payload,
		{ type: 'pageview', path: event.path, hostname: HOST },
		{
			req: {
				payload: booted.payload,
				headers: new Headers({
					'x-vercel-ip-country': event.country,
					'x-forwarded-for': event.ip,
					'user-agent': UA,
					...(event.tenant ? { 'x-tenant': event.tenant } : {}),
				}),
			} as unknown as PayloadRequest,
		}
	)

const seedAll = async (booted: BootedPayload, events: Seed[]): Promise<void> => {
	for (const event of events) {
		await seed(booted, event)
	}
}

// Two countries and two page prefixes, so an eq filter on country and a contains filter
// on page each narrow to a different, checkable subset.
const traffic: Seed[] = [
	{ path: '/a', country: 'DE', ip: '1.1.1.1' },
	{ path: '/blog/intro', country: 'DE', ip: '1.1.1.2' },
	{ path: '/blog/deep', country: 'US', ip: '1.1.1.3' },
	{ path: '/a', country: 'US', ip: '1.1.1.4' },
	{ path: '/a', country: 'US', ip: '1.1.1.5' },
]

describeForDb('widget filters against the native adapter', {}, (db) => {
	let booted: BootedPayload
	let range: DateRange

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
		await seedAll(booted, traffic)
		range = windowAround(Date.now())
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const req = () => ({ payload: booted.payload }) as unknown as PayloadRequest

	const metric = (filters?: AnalyticsFilter[]) =>
		readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'today',
			now: new Date(),
			range,
			timezone: 'UTC',
			comparison: false,
			...(filters ? { filters } : {}),
		})

	const breakdown = (filters?: AnalyticsFilter[]) =>
		readForWidgetBreakdown({
			req: req(),
			metric: 'pageviews',
			dimension: 'page',
			timeframe: 'today',
			limit: 10,
			now: new Date(),
			range,
			timezone: 'UTC',
			...(filters ? { filters } : {}),
		})

	it('narrows the metric widget total with a native eq filter on country', async () => {
		const all = await metric()
		expect(all.status).toBe('ok')
		expect(all.metrics.pageviews).toBe(5)

		const german = await metric([{ dimension: 'country', operator: 'eq', value: 'DE' }])
		expect(german.status).toBe('ok')
		expect(german.metrics.pageviews).toBe(2)
	})

	it('narrows the breakdown rows with the same filter', async () => {
		const all = await breakdown()
		expect(all.status).toBe('ok')
		expect(byLabel(all.rows)).toEqual([
			{ label: '/a', value: 3 },
			{ label: '/blog/deep', value: 1 },
			{ label: '/blog/intro', value: 1 },
		])

		const american = await breakdown([{ dimension: 'country', operator: 'eq', value: 'US' }])
		expect(american.status).toBe('ok')
		expect(byLabel(american.rows)).toEqual([
			{ label: '/a', value: 2 },
			{ label: '/blog/deep', value: 1 },
		])
	})

	it('narrows the breakdown to a page prefix with a contains filter', async () => {
		const blog = await breakdown([{ dimension: 'page', operator: 'contains', value: '/blog' }])
		expect(blog.status).toBe('ok')
		expect(byLabel(blog.rows)).toEqual([
			{ label: '/blog/deep', value: 1 },
			{ label: '/blog/intro', value: 1 },
		])
	})

	it('answers filter-unsupported for an operator the native adapter does not declare', async () => {
		// native declares eq and contains; `matches` is a provider-only operator.
		const result = await metric([{ dimension: 'page', operator: 'matches', value: '^/blog' }])
		expect(result.status).toBe('filter-unsupported')
		expect(result.metrics.pageviews).toBeUndefined()
	})

	it('answers filter-unsupported for a dimension the native adapter cannot filter on', async () => {
		// native groups by `goal` but cannot filter by it: completions live in a json column.
		const result = await metric([{ dimension: 'goal', operator: 'eq', value: 'thanks' }])
		expect(result.status).toBe('filter-unsupported')
	})

	it('narrows the metric widget total with an eq filter on a classified dimension', async () => {
		const chrome = await metric([{ dimension: 'browser', operator: 'eq', value: 'chrome' }])
		expect(chrome.status).toBe('ok')
		expect(chrome.metrics.pageviews).toBe(5)
	})
})

const caps = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsCapabilities => ({
	perPageQuery: false,
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['page']),
	filters: new Set(['page']),
	filterOperators: new Set(['eq', 'contains', 'matches']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
	...over,
})

/** PostHog-shaped: it declares `matches` and answers it as a regular expression. */
const patternAdapter = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsAdapter => {
	const paths = ['/docs/start', '/docs/api', '/blog/intro']
	return {
		id: 'patterns',
		label: 'Patterns',
		capabilities: caps(over),
		isConfigured: () => true,
		async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			const matched = paths.filter((path) =>
				(q.filters ?? []).every((filter) => {
					if (filter.dimension !== 'page') return false
					if (filter.operator === 'matches') return new RegExp(filter.value).test(path)
					if (filter.operator === 'contains') return path.includes(filter.value)
					return path === filter.value
				})
			)
			return {
				rows: matched.map((path) => ({
					dimensions: { page: path },
					metrics: { pageviews: 1 },
				})),
				totals: { pageviews: matched.length },
				meta: { provider: 'patterns', fetchedAt: new Date().toISOString() },
			}
		},
	}
}

describeForDb('widget filters against a provider that matches patterns', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [patternAdapter()] }), db })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('applies a matches filter the provider declares', async () => {
		const result = await readForWidget({
			req: { payload: booted.payload } as unknown as PayloadRequest,
			metrics: ['pageviews'],
			timeframe: 'today',
			now: new Date(),
			range: windowAround(Date.now()),
			timezone: 'UTC',
			comparison: false,
			filters: [{ dimension: 'page', operator: 'matches', value: '^/docs' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
	})
})

describeForDb('widget filters against a source that cannot filter', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [patternAdapter({ filters: new Set(), filterOperators: new Set() })],
			}),
			db,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('answers filter-unsupported rather than an unfiltered total', async () => {
		const result = await readForWidget({
			req: { payload: booted.payload } as unknown as PayloadRequest,
			metrics: ['pageviews'],
			timeframe: 'today',
			now: new Date(),
			range: windowAround(Date.now()),
			timezone: 'UTC',
			comparison: false,
			filters: [{ dimension: 'page', operator: 'eq', value: '/docs/api' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(result.metrics.pageviews).toBeUndefined()
	})
})

describeForDb('widget filters on a scoped install', {}, (db) => {
	let booted: BootedPayload
	let range: DateRange

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
			}),
			db,
		})
		await seedAll(booted, [
			{ path: '/a', country: 'DE', ip: '2.2.2.1', tenant: 'tenant-a' },
			{ path: '/a', country: 'DE', ip: '2.2.2.2', tenant: 'tenant-a' },
			{ path: '/a', country: 'DE', ip: '2.2.2.3', tenant: 'tenant-b' },
			{ path: '/a', country: 'DE', ip: '2.2.2.4', tenant: 'tenant-b' },
			{ path: '/a', country: 'DE', ip: '2.2.2.5', tenant: 'tenant-b' },
		])
		range = windowAround(Date.now())
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const readFor = (tenant: string, filters?: AnalyticsFilter[]) =>
		readForWidget({
			req: {
				payload: booted.payload,
				headers: new Headers({ 'x-tenant': tenant }),
			} as unknown as PayloadRequest,
			metrics: ['pageviews'],
			timeframe: 'today',
			now: new Date(),
			range,
			timezone: 'UTC',
			comparison: false,
			...(filters ? { filters } : {}),
		})

	it('never widens the scope: a filtered tenant read still excludes the other tenant', async () => {
		const unfiltered = await readFor('tenant-a')
		expect(unfiltered.status).toBe('ok')
		expect(unfiltered.metrics.pageviews).toBe(2)

		const filtered = await readFor('tenant-a', [
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
		expect(filtered.status).toBe('ok')
		// Every tenant-a event is German, so the filter changes nothing but the scope holds.
		expect(filtered.metrics.pageviews).toBe(2)
	})
})
