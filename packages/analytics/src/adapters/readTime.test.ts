import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../core/contract'
import { ga4 } from './ga4/ga4'
import { plausible } from './plausible/plausible'
import { posthog } from './posthog/posthog'
import { readTime } from './readTime'
import { umami } from './umami/umami'

const READ_AT = new Date('2026-03-01T09:30:00.000Z')

/** A goal breakdown with no goals to read: each adapter answers it before any request. */
const noGoals: AnalyticsQuery = {
	metrics: ['conversions'],
	dimensions: ['goal'],
	dateRange: { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-31T23:59:59.999Z') },
	goalSlugs: [],
}

const adapters: AnalyticsAdapter[] = [
	plausible({ siteId: 'example.com', apiKey: 'key' }),
	umami({ websiteId: 'site', apiKey: 'key' }),
	posthog({ projectId: '1', apiKey: 'phx_key' }),
	ga4({ propertyId: '1', credentials: { client_email: 'a@b.c', private_key: 'k' } }),
]

describe('readTime', () => {
	it('is the clock the engine hands the read', () => {
		expect(readTime({ now: () => READ_AT })).toBe(READ_AT.toISOString())
	})

	it('is the real clock for a read outside the engine', () => {
		const before = Date.now()
		const at = Date.parse(readTime(undefined))
		expect(at).toBeGreaterThanOrEqual(before)
		expect(at).toBeLessThanOrEqual(Date.now())
	})

	it.each(
		adapters.map((adapter) => [adapter.id, adapter] as const)
	)('dates %s answers to the read, not to the end of the range', async (_id, adapter) => {
		const result = await adapter.query(noGoals, { now: () => READ_AT })
		expect(result.meta.fetchedAt).toBe(READ_AT.toISOString())
	})
})
