import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { Payload, WidgetServerProps } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
} from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import type { QueryResponse } from '../../src/query/response'
import { renderSettled } from '../../src/testing/renderSettled'
import { DAY_MS, startOfDayInTz } from '../../src/timeframe/tz'
import AnalyticsGoalsWidget from '../../src/widgets/AnalyticsGoalsWidget'
import { readForWidgetGoals } from '../../src/widgets/readForWidgetGoals'
import { callEndpoint } from './endpointHelpers'
import { nativeOf, pageviewHit, postBeacon } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const goals: Goal[] = [
	{ slug: 'thanks', name: 'Thank you page', match: { kind: 'path', pattern: '/thank-you' } },
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' }, currency: 'EUR' },
	{
		slug: 'newsletter',
		name: 'Newsletter',
		match: { kind: 'event', name: 'newsletter_signup' },
		value: { fixed: 2 },
	},
]

/** The config goals above and the `demo` goal the unscoped install adds to its collection. */
const INSTALL_GOAL_SLUGS = new Set(['thanks', 'purchase', 'newsletter', 'demo'])

const providerCapabilities: AnalyticsCapabilities = {
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors', 'conversions', 'revenue']),
	dimensions: new Set(['page', 'goal']),
	filters: { page: ['eq'] },
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 3600 },
}

/**
 * A source shaped like the provider adapters: it counts goals only for the slugs the read
 * hints at, and says so when a goal read arrives without them.
 */
const providerStub = (seen: AnalyticsQuery[]): AnalyticsAdapter => ({
	id: 'provider-stub',
	label: 'Provider stub',
	capabilities: providerCapabilities,
	isConfigured: () => true,
	query: async (q) => {
		seen.push(q)
		const fetchedAt = q.dateRange.end.toISOString()
		const slugs = q.goalSlugs === undefined || q.goalSlugs === 'unresolved' ? [] : q.goalSlugs
		if ((q.dimensions ?? []).includes('goal')) {
			if (slugs.length === 0) {
				return { rows: [], meta: { provider: 'provider-stub', fetchedAt, goalsUnresolved: true } }
			}
			return {
				rows: slugs.map((slug, i) => ({
					dimensions: { goal: slug },
					metrics: { conversions: 10 - i, revenue: i * 5, visitors: 10 - i },
				})),
				meta: { provider: 'provider-stub', fetchedAt },
			}
		}
		return { rows: [], totals: { visitors: 40 }, meta: { provider: 'provider-stub', fetchedAt } }
	},
})

interface IngestArgs {
	/** Stands in as the user agent, one of the inputs the visitor hash derives from. */
	visitor: string
	body: Record<string, unknown>
	headers?: Record<string, string>
}

/** One ingest per visitor, so each seeded visitor counts as its own. */
const ingestAs = async (payload: Payload, args: IngestArgs): Promise<void> => {
	const res = await postBeacon(
		payload,
		{ hostname: 'h', ...args.body },
		{ 'user-agent': args.visitor, ...args.headers }
	)
	expect(res.status).toBe(202)
}

describeForDb('goals widget read: unscoped native install', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const providerQueries: AnalyticsQuery[] = []

	// Today, so the seeded previous day stays out of the current window and only the
	// comparison read sees it.
	const read = (over: { compare?: boolean; limit?: number } = {}) =>
		readForWidgetGoals({
			req: readerRequest(booted.payload),
			timeframe: 'today',
			limit: over.limit ?? 10,
			compare: over.compare ?? false,
			now: clock.now(),
		})

	beforeAll(async () => {
		// Held still, so the seeding and every read below fall on one day whenever midnight passes.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native(), providerStub(providerQueries)],
				defaultAdapter: 'native',
				revenue: true,
				goals: { defaults: goals, collection: true },
			}),
		})
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Demo requested',
				slug: 'demo',
				match: { kind: 'event', name: 'demo_requested' },
			} as never,
		})
		// Six visitors: three complete the path goal, two purchase, one signs up, and the
		// last also asks for a demo (the collection goal).
		const purchase = { type: 'goal', name: 'purchase', path: '/checkout', value: 25.5 }
		for (const visitor of ['ua-1', 'ua-2', 'ua-3']) {
			await ingestAs(booted.payload, { visitor, body: { type: 'pageview', path: '/thank-you' } })
		}
		await ingestAs(booted.payload, { visitor: 'ua-4', body: purchase })
		await ingestAs(booted.payload, { visitor: 'ua-5', body: purchase })
		await ingestAs(booted.payload, {
			visitor: 'ua-6',
			body: { type: 'event', name: 'newsletter_signup', path: '/pricing' },
		})
		await ingestAs(booted.payload, {
			visitor: 'ua-6',
			body: { type: 'event', name: 'demo_requested', path: '/pricing' },
		})
		// The previous window, seeded straight into the store: ingest always stamps now. Four
		// purchases yesterday at noon, worth 100 together.
		const yesterday = new Date(startOfDayInTz(clock.now(), 'UTC').getTime() - DAY_MS / 2)
		await nativeOf(booted.payload).store.append(
			['p-1', 'p-2', 'p-3', 'p-4'].map((v) => ({
				...pageviewHit({ ts: yesterday, v, path: '/checkout' }),
				type: 'goal' as const,
				name: 'purchase',
				landing: false,
				value: 25,
				currency: 'EUR',
				goals: [{ slug: 'purchase', value: 25 }],
				conversions: 1,
				revenue: 25,
			}))
		)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it(`ranks the goals by conversions with their revenue on ${db}`, async () => {
		const result = await read()
		expect(result.status).toBe('ok')
		expect(result.rows.slice(0, 2).map((r) => [r.slug, r.conversions, r.revenue])).toEqual([
			['thanks', 3, 0],
			['purchase', 2, 51],
		])
		// The last two both converted once; their relative order is the source's to decide.
		const tail = new Map(result.rows.slice(2).map((r) => [r.slug, [r.conversions, r.revenue]]))
		expect(tail.get('newsletter')).toEqual([1, 2])
		expect(tail.get('demo')).toEqual([1, 0])
	})

	it(`names a config goal and a collection goal on ${db}`, async () => {
		const names = new Map((await read()).rows.map((r) => [r.slug, r.name]))
		expect(names.get('purchase')).toBe('Purchase')
		expect(names.get('demo')).toBe('Demo requested')
	})

	it(`divides each goal's visitors by the site's for the rate on ${db}`, async () => {
		const result = await read()
		expect(result.siteVisitors).toBe(6)
		const rate = new Map(result.rows.map((r) => [r.slug, r.rate]))
		expect(rate.get('thanks')).toBe(0.5)
		expect(rate.get('purchase')).toBeCloseTo(0.3333, 4)
		expect(rate.get('newsletter')).toBeCloseTo(0.1667, 4)
	})

	it(`limits the table on ${db}`, async () => {
		const result = await read({ limit: 2 })
		expect(result.rows.map((r) => r.slug)).toEqual(['thanks', 'purchase'])
	})

	it(`joins the previous window onto the goal it belongs to on ${db}`, async () => {
		const result = await read({ compare: true })
		const previous = new Map(result.rows.map((r) => [r.slug, r.previousConversions]))
		expect(previous.get('purchase')).toBe(4)
		expect(previous.get('thanks')).toBeUndefined()
	})

	it(`hints the install's goal slugs to a provider-shaped source on ${db}`, async () => {
		providerQueries.length = 0
		const result = await readForWidgetGoals({
			req: readerRequest(booted.payload),
			timeframe: 'last30days',
			limit: 10,
			compare: false,
			adapterId: 'provider-stub',
			now: new Date(),
		})
		const goalRead = providerQueries.find((q) => (q.dimensions ?? []).includes('goal'))
		expect(new Set(goalRead?.goalSlugs)).toEqual(INSTALL_GOAL_SLUGS)
		expect(result.status).toBe('ok')
		expect(result.rows).toHaveLength(4)
		// The source served the rows, and the install named them.
		expect(new Map(result.rows.map((r) => [r.slug, r.name])).get('purchase')).toBe('Purchase')
	})

	it(`renders the goals widget on a provider-shaped source on ${db}`, async () => {
		const req = readerRequest(booted.payload, {
			i18n: { t: (key: string) => key, language: 'en' },
		})
		const html = await renderSettled(
			AnalyticsGoalsWidget({
				req,
				widgetData: { dataSource: 'provider-stub' },
			} as unknown as WidgetServerProps)
		)
		expect(html).toContain('<table')
		expect(html).toContain('Purchase')
		expect(html).toContain('analytics:metricConversions')
	})

	it(`sends the scope's goal slugs to the source through the query endpoint on ${db}`, async () => {
		providerQueries.length = 0
		const res = await callEndpoint(booted.payload, {
			path: routes.query,
			query:
				'source=provider-stub&metrics=conversions&dimensions=goal&from=2026-01-10&to=2026-01-16',
			user: { id: 1, email: 'reader@t.dev', collection: booted.payload.config.admin.user },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(new Set(providerQueries[0]?.goalSlugs)).toEqual(INSTALL_GOAL_SLUGS)
		expect(new Set(body.query.goalSlugs)).toEqual(INSTALL_GOAL_SLUGS)
		expect(body.result.rows).toHaveLength(4)
		expect(body.result.meta.goalsUnresolved).toBeUndefined()
	})
})

describeForDb('goals widget read: scoped native install', {}, (db) => {
	let booted: BootedPayload

	const readAs = (tenant: string) =>
		readForWidgetGoals({
			req: readerRequest(booted.payload, { headers: new Headers({ 'x-tenant': tenant }) }),
			timeframe: 'last30days',
			limit: 10,
			compare: false,
			now: new Date(),
		})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				goals: [
					{ slug: 'alpha-goal', name: 'Alpha goal', match: { kind: 'goal' } },
					{ slug: 'beta-goal', name: 'Beta goal', match: { kind: 'goal' } },
				],
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
			}),
		})
		await ingestAs(booted.payload, {
			visitor: 'ua-alpha',
			body: { type: 'goal', name: 'alpha-goal', path: '/a' },
			headers: { 'x-tenant': 'alpha' },
		})
		await ingestAs(booted.payload, {
			visitor: 'ua-beta',
			body: { type: 'goal', name: 'beta-goal', path: '/b' },
			headers: { 'x-tenant': 'beta' },
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`keeps each tenant's goals to itself on ${db}`, async () => {
		const alpha = await readAs('alpha')
		const beta = await readAs('beta')
		expect(alpha.rows.map((r) => r.slug)).toEqual(['alpha-goal'])
		expect(beta.rows.map((r) => r.slug)).toEqual(['beta-goal'])
	})
})
