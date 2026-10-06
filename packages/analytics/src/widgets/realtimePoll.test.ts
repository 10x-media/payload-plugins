import { describe, expect, it } from 'vitest'
import {
	buildPollPath,
	buildRealtimeEndpoint,
	isPollRefusalFinal,
	toRealtimePoints,
} from './realtimePoll'

describe('buildRealtimeEndpoint', () => {
	it('builds the endpoint from the configured server URL and API route, not a hardcoded /api', () => {
		expect(buildRealtimeEndpoint('https://example.com', '/api')).toBe(
			'https://example.com/api/analytics/realtime'
		)
	})
	it('respects a custom API route', () => {
		expect(buildRealtimeEndpoint('https://example.com', '/custom-api')).toBe(
			'https://example.com/custom-api/analytics/realtime'
		)
	})
	it('omits the server URL when unset (relative fetch)', () => {
		expect(buildRealtimeEndpoint(undefined, '/api')).toBe('/api/analytics/realtime')
	})
})

describe('buildPollPath', () => {
	it('builds the query string from the poll config', () => {
		expect(
			buildPollPath('/api/analytics/realtime', {
				metric: 'visitors',
				windowMinutes: 30,
				dataSource: 'native',
			})
		).toBe('/api/analytics/realtime?metric=visitors&windowMinutes=30&dataSource=native')
	})
	it('omits dataSource when absent', () => {
		expect(
			buildPollPath('/api/analytics/realtime', { metric: 'pageviews', windowMinutes: 5 })
		).toBe('/api/analytics/realtime?metric=pageviews&windowMinutes=5')
	})
})

describe('toRealtimePoints', () => {
	it('maps a minute series to chart points with HH:MM labels and formatted display', () => {
		const points = toRealtimePoints([{ date: '2026-06-24T10:05:00.000Z', value: 1200 }], 'en-US')
		expect(points[0]?.value).toBe(1200)
		expect(points[0]?.display).toBe('1,200')
		expect(typeof points[0]?.label).toBe('string')
	})
})

describe('isPollRefusalFinal', () => {
	const refusal = (body: unknown): Response =>
		({ ok: false, json: async () => body }) as unknown as Response

	it('is final for a refusal aimed at this reader', async () => {
		expect(
			await isPollRefusalFinal(refusal({ error: { code: 'unauthorized', message: 'x' } }))
		).toBe(true)
		expect(await isPollRefusalFinal(refusal({ error: { code: 'forbidden', message: 'x' } }))).toBe(
			true
		)
	})

	it('keeps polling through an outage, which the next tick may well survive', async () => {
		expect(
			await isPollRefusalFinal(refusal({ error: { code: 'unavailable', message: 'x' } }))
		).toBe(false)
		expect(await isPollRefusalFinal(refusal({ error: { code: 'internal', message: 'x' } }))).toBe(
			false
		)
	})

	it('keeps polling on a legacy string body and on one that is not JSON at all', async () => {
		expect(await isPollRefusalFinal(refusal({ error: 'forbidden' }))).toBe(false)
		const broken = {
			ok: false,
			json: () => Promise.reject(new Error('not json')),
		} as unknown as Response
		expect(await isPollRefusalFinal(broken)).toBe(false)
	})
})
