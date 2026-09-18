import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DimensionKey, MetricKey } from '../../src/core/contract'
import { AnalyticsTrackError } from '../../src/core/serverEvent'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime } from '../../src/plugin/runtime'

const DAY_MS = 86_400_000
const HOST = 'shop.example'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'

const configGoals: Goal[] = [
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
	{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup_done' } },
]

const metrics: MetricKey[] = ['pageviews', 'visitors', 'events', 'conversions', 'revenue']

/** What every requested metric reads as when nothing at all was recorded for the bucket. */
const NOTHING: Partial<Record<MetricKey, number>> = {
	pageviews: 0,
	visitors: 0,
	events: 0,
	conversions: 0,
	revenue: 0,
}

describeForDb('analytics server track: unscoped', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (path: string): Promise<Partial<Record<MetricKey, number>>> => {
		const result = await adapter.query({ path, metrics, dateRange: range }, {})
		return result.totals ?? {}
	}

	/** Pageviews per value of one dimension, for one path: order-independent across tests. */
	const breakdown = async (
		path: string,
		dimension: DimensionKey
	): Promise<Record<string, number>> => {
		const result = await adapter.query(
			{ path, metrics: ['pageviews'], dimensions: [dimension], dateRange: range },
			{}
		)
		return Object.fromEntries(
			result.rows.map((row) => [String(row.dimensions?.[dimension]), row.metrics.pageviews ?? 0])
		)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [adapter], goals: { defaults: configGoals } }),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('completes a goal from a script with no request behind it', async () => {
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			hostname: HOST,
			value: 99,
			currency: 'EUR',
		})
		expect(await totalsFor('/checkout')).toMatchObject({ conversions: 1, revenue: 99 })
	})

	it('counts one visitor for repeated server events on the same day', async () => {
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/server', hostname: HOST })
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/server', hostname: HOST })
		expect(await totalsFor('/server')).toMatchObject({ pageviews: 2, visitors: 1 })
	})

	it('records an event through runtime.track', async () => {
		await getRuntime(booted.payload)?.track?.({
			type: 'event',
			name: 'signup_done',
			path: '/welcome',
			hostname: HOST,
		})
		expect(await totalsFor('/welcome')).toMatchObject({ events: 1, conversions: 1 })
	})

	it('attributes geo and device from the request it is given, and abstains without one', async () => {
		await trackServerEvent(booted.payload, {
			type: 'pageview',
			path: '/no-request',
			hostname: HOST,
		})
		// A script event carries no user agent, so it lands in no device bucket at all.
		expect(await breakdown('/no-request', 'device')).toEqual({})
		const req = {
			payload: booted.payload,
			headers: new Headers({ 'x-vercel-ip-country': 'US', 'user-agent': IPHONE_UA }),
		} as unknown as PayloadRequest
		await trackServerEvent(
			booted.payload,
			{ type: 'pageview', path: '/from-browser', hostname: HOST },
			{ req }
		)
		expect(await breakdown('/from-browser', 'device')).toEqual({ mobile: 1 })
		expect(await breakdown('/from-browser', 'country')).toEqual({ US: 1 })
	})

	it('refuses an invalid event instead of writing a broken one', async () => {
		await expect(
			trackServerEvent(booted.payload, {
				type: 'goal',
				path: '/nameless',
				hostname: HOST,
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(await totalsFor('/nameless')).toEqual(NOTHING)
	})
})

describeForDb('analytics server track: scoped', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (
		path: string,
		scope: string
	): Promise<Partial<Record<MetricKey, number>>> => {
		const result = await adapter.query({ path, scope, metrics, dateRange: range }, {})
		return result.totals ?? {}
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				access: { platformRead: () => true },
				goals: { collection: true },
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stamps an explicit scope and keeps it out of every other scope', async () => {
		await trackServerEvent(booted.payload, {
			type: 'pageview',
			path: '/alpha-only',
			hostname: HOST,
			scope: 'alpha',
		})
		expect(await totalsFor('/alpha-only', 'alpha')).toMatchObject({ pageviews: 1 })
		expect(await totalsFor('/alpha-only', 'beta')).toEqual(NOTHING)
	})

	it('matches a collection goal belonging to the event’s scope', async () => {
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Invoice paid',
				slug: 'invoice-paid',
				match: { kind: 'goal' },
				scope: 'alpha',
			} as never,
		})
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'invoice-paid',
			path: '/billing',
			hostname: HOST,
			value: 12,
			scope: 'alpha',
		})
		expect(await totalsFor('/billing', 'alpha')).toMatchObject({ conversions: 1, revenue: 12 })
		// The same goal event under another scope completes nothing: goals resolve per scope.
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'invoice-paid',
			path: '/billing',
			hostname: HOST,
			value: 12,
			scope: 'beta',
		})
		expect(await totalsFor('/billing', 'beta')).toMatchObject({ conversions: 0, revenue: 0 })
	})

	it('resolves the scope from a request when the caller has one', async () => {
		const req = {
			payload: booted.payload,
			headers: new Headers({ 'x-tenant': 'beta' }),
		} as unknown as PayloadRequest
		await trackServerEvent(
			booted.payload,
			{ type: 'pageview', path: '/from-req', hostname: HOST },
			{ req }
		)
		expect(await totalsFor('/from-req', 'beta')).toMatchObject({ pageviews: 1 })
		expect(await totalsFor('/from-req', 'alpha')).toEqual(NOTHING)
	})
})
