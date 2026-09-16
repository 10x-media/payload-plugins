import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../core/contract'
import type { QueryError } from '../query/errors'
import { makeQueryHandler, serializeQuery } from './queryEndpoint'

const reqWithoutRuntime = (): PayloadRequest =>
	({ user: { id: 1 }, payload: {} as unknown as Payload }) as unknown as PayloadRequest

describe('makeQueryHandler without a runtime', () => {
	it('answers 503 unavailable with the same Retry-After a provider outage carries', async () => {
		const res = await makeQueryHandler()(reqWithoutRuntime())

		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('30')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		const { error } = (await res.json()) as { error: QueryError }
		expect(error.code).toBe('unavailable')
	})
})

describe('serializeQuery', () => {
	const query = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
		metrics: ['conversions'],
		dimensions: ['goal'],
		dateRange: {
			start: new Date('2026-09-01T00:00:00.000Z'),
			end: new Date('2026-09-07T23:59:59.999Z'),
		},
		...over,
	})

	it('echoes the window as ISO instants', () => {
		expect(serializeQuery(query()).dateRange).toEqual({
			start: '2026-09-01T00:00:00.000Z',
			end: '2026-09-07T23:59:59.999Z',
		})
	})

	// The documented wire shape: a client reading the echo can tell a scope with no goals
	// from one whose resolver failed, which is the difference between an empty table and a
	// table that means nothing.
	it('echoes each goal hint as the read carried it', () => {
		expect(serializeQuery(query({ goalSlugs: ['signup'] })).goalSlugs).toEqual(['signup'])
		expect(serializeQuery(query({ goalSlugs: [] })).goalSlugs).toEqual([])
		expect(serializeQuery(query({ goalSlugs: 'unresolved' })).goalSlugs).toBe('unresolved')
		expect(serializeQuery(query()).goalSlugs).toBeUndefined()
	})
})
