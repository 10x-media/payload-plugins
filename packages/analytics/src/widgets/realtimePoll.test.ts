import { describe, expect, it } from 'vitest'
import { buildPollPath, buildRealtimeEndpoint, toRealtimePoints } from './realtimePoll'

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
