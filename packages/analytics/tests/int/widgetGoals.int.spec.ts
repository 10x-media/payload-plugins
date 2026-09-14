import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { ROLLUPS_SLUG } from '../../src/native/collections/rollups'
import { native } from '../../src/native/nativeAdapter'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { readForWidgetGoals } from '../../src/widgets/readForWidgetGoals'
import { ingestRequest } from './ingestRequest'

const DAY_MS = 86_400_000

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

interface IngestArgs {
	/** Stands in as the user agent, one of the inputs the visitor hash derives from. */
	visitor: string
	body: Record<string, unknown>
	headers?: Record<string, string>
}

/** One ingest per visitor, so each seeded visitor counts as its own. */
const ingestAs = async (payload: Payload, args: IngestArgs): Promise<void> => {
	const endpoint = (payload.config.endpoints ?? []).find(
		(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
	)
	if (!endpoint || typeof endpoint.handler !== 'function') {
		throw new Error('ingest endpoint not registered')
	}
	const res = await endpoint.handler(
		ingestRequest(
			payload,
			{ hostname: 'h', ...args.body },
			{ 'user-agent': args.visitor, ...args.headers }
		)
	)
	expect(res.status).toBe(202)
}

describeForDb('goals widget read: unscoped native install', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	// Today, so the seeded previous day stays out of the current window and only the
	// comparison read sees it.
	const read = (over: { compare?: boolean; limit?: number } = {}) =>
		readForWidgetGoals({
			req: { payload: booted.payload, headers: new Headers() } as unknown as PayloadRequest,
			timeframe: 'today',
			limit: over.limit ?? 10,
			compare: over.compare ?? false,
			now: new Date(),
		})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
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
		// The previous window, seeded straight into the rollups: ingest always stamps now.
		// Through the db adapter, since the rollup writer's own buckets key on empty strings
		// that the collection's required text fields reject through the document API.
		await booted.payload.db.create({
			collection: ROLLUPS_SLUG,
			data: {
				granularity: 'day',
				period: new Date(startOfDayInTz(new Date(), 'UTC').getTime() - DAY_MS).toISOString(),
				path: '',
				dimension: 'goal',
				dimvalue: 'purchase',
				hostname: '',
				events: 1,
				samples: 1,
				visitors: 1,
				sessions: 1,
				conversions: 4,
				revenue: 100,
			} as never,
		})
	}, 240_000)

	afterAll(async () => {
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
		const byslug = new Map((await read()).rows.map((r) => [r.slug, r.name]))
		expect(byslug.get('purchase')).toBe('Purchase')
		expect(byslug.get('demo')).toBe('Demo requested')
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
})

describeForDb('goals widget read: scoped native install', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	const readAs = (tenant: string) =>
		readForWidgetGoals({
			req: {
				payload: booted.payload,
				headers: new Headers({ 'x-tenant': tenant }),
			} as unknown as PayloadRequest,
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
				goals: [
					{ slug: 'alpha-goal', name: 'Alpha goal', match: { kind: 'goal' } },
					{ slug: 'beta-goal', name: 'Beta goal', match: { kind: 'goal' } },
				],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
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
