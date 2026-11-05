import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_CONFIG_KEY } from '../plugin/routes'
import { QueryFetchError } from '../ui/data/request'
import {
	buildPollPath,
	buildRealtimeEndpoint,
	isPollRefusalFinal,
	readRealtimeReading,
	toRealtimePoints,
} from './realtimePoll'

describe('buildRealtimeEndpoint', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("builds a relative endpoint from the app's API route, never its serverURL", () => {
		expect(buildRealtimeEndpoint({ routes: { api: '/api' } })).toBe('/api/_x/live')
	})

	it('respects a custom API route and a moved base', () => {
		const moved = {
			routes: { api: '/custom-api' },
			admin: { custom: { [ANALYTICS_CONFIG_KEY]: { routes: { base: '/stats' } } } },
		}
		expect(buildRealtimeEndpoint(moved)).toBe('/custom-api/stats/live')
	})

	it('sits behind the Next basePath', () => {
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		expect(buildRealtimeEndpoint({ routes: { api: '/api' } })).toBe('/docs/api/_x/live')
	})
})

describe('buildPollPath', () => {
	it('builds the query string from the poll config', () => {
		expect(
			buildPollPath('/api/_x/live', {
				metric: 'visitors',
				windowMinutes: 30,
				dataSource: 'native',
			})
		).toBe('/api/_x/live?metric=visitors&windowMinutes=30&dataSource=native')
	})
	it('omits dataSource when absent', () => {
		expect(buildPollPath('/api/_x/live', { metric: 'pageviews', windowMinutes: 5 })).toBe(
			'/api/_x/live?metric=pageviews&windowMinutes=5'
		)
	})
	it('asks for the total alone when the poll draws no series', () => {
		expect(
			buildPollPath('/api/_x/live', { metric: 'visitors', windowMinutes: 30, series: false })
		).toBe('/api/_x/live?metric=visitors&windowMinutes=30&series=0')
		expect(
			buildPollPath('/api/_x/live', { metric: 'visitors', windowMinutes: 30, series: true })
		).toBe('/api/_x/live?metric=visitors&windowMinutes=30')
	})
})

describe('toRealtimePoints', () => {
	it('maps a minute series to chart points with HH:MM labels and formatted display', () => {
		const points = toRealtimePoints(
			[{ date: '2026-06-24T10:05:00.000Z', value: 1200 }],
			'en-US',
			'UTC'
		)
		expect(points[0]?.value).toBe(1200)
		expect(points[0]?.display).toBe('1,200')
		expect(points[0]?.label).toBe('10:05 AM UTC')
		expect(points[0]?.at).toBe('2026-06-24T10:05:00.000Z')
	})

	it('labels in the reporting timezone, not the runtime one', () => {
		const berlin = toRealtimePoints(
			[{ date: '2026-06-24T10:05:00.000Z', value: 1 }],
			'en-US',
			'Europe/Berlin'
		)
		expect(berlin[0]?.label).toBe('12:05 PM GMT+2')
	})

	// The reporting zone is not the reader's: the axis says which it is once, the tooltip each time.
	it('names the zone beside the last minute on the axis and in every tooltip', () => {
		const points = toRealtimePoints(
			[
				{ date: '2026-06-24T10:04:00.000Z', value: 1 },
				{ date: '2026-06-24T10:05:00.000Z', value: 2 },
			],
			'de',
			'Europe/Berlin'
		)
		expect(points.map((point) => point.label)).toEqual(['12:04', '12:05 MESZ'])
		expect(points.map((point) => point.tooltipLabel)).toEqual(['12:04 MESZ', '12:05 MESZ'])
	})
})

describe('isPollRefusalFinal', () => {
	it('is final for a refusal aimed at this reader, whatever its body says', () => {
		expect(
			isPollRefusalFinal(new QueryFetchError(401, { code: 'unauthorized', message: 'x' }))
		).toBe(true)
		expect(isPollRefusalFinal(new QueryFetchError(403, { code: 'forbidden', message: 'x' }))).toBe(
			true
		)
		expect(isPollRefusalFinal(new QueryFetchError(403))).toBe(true)
	})

	it('keeps polling through an outage, which the next tick may well survive', () => {
		expect(
			isPollRefusalFinal(new QueryFetchError(503, { code: 'unavailable', message: 'x' }, 30))
		).toBe(false)
		expect(isPollRefusalFinal(new QueryFetchError(500, { code: 'internal', message: 'x' }))).toBe(
			false
		)
	})

	it('keeps polling through a network failure', () => {
		expect(isPollRefusalFinal(new TypeError('fetch failed'))).toBe(false)
	})
})

describe('readRealtimeReading', () => {
	it('reads the count, the minutes that carry a value and the sampled flag', () => {
		expect(
			readRealtimeReading({
				status: 'ok',
				activeNow: 4,
				series: [{ date: '2026-06-24T10:05:00.000Z', value: 4 }, { date: 'x' }],
				sampled: true,
			})
		).toEqual({
			activeNow: 4,
			series: [{ date: '2026-06-24T10:05:00.000Z', value: 4 }],
			sampled: true,
		})
	})

	it('carries no reading for an answer that is not ok, such as a page with no path yet', () => {
		expect(
			readRealtimeReading({ status: 'unavailable', adapterId: '', activeNow: 0, series: [] })
		).toBeNull()
		expect(readRealtimeReading(null)).toBeNull()
		expect(readRealtimeReading({ status: 'ok' })).toBeNull()
	})
})
