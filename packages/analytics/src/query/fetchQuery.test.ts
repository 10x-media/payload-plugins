import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildQueryUrl, fetchQuery, QueryFetchError, type QueryRequest } from './fetchQuery'
import type { QueryResponse } from './response'

const baseRequest: QueryRequest = {
	metrics: ['pageviews'],
	from: '2026-09-01',
	to: '2026-09-07',
}

const okResponse = (body: unknown, headers: Record<string, string> = {}) =>
	({
		ok: true,
		status: 200,
		headers: new Headers(headers),
		json: async () => body,
	}) as unknown as Response

const errorResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	({
		ok: false,
		status,
		headers: new Headers(headers),
		json: async () => {
			if (body === undefined) throw new SyntaxError('Unexpected end of JSON input')
			return body
		},
	}) as unknown as Response

const sampleResult: QueryResponse = {
	result: {
		rows: [{ metrics: { pageviews: 10 } }],
		meta: { provider: 'native', fetchedAt: '2026-09-07T00:00:00.000Z' },
	},
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities: {
		metrics: ['pageviews'],
		dimensions: [],
		filters: [],
		filterOperators: [],
		minGranularity: 'day',
		comparison: false,
		realtime: false,
		perPageQuery: false,
		maxLookbackDays: null,
	},
	query: {
		metrics: ['pageviews'],
		dateRange: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-07T23:59:59.999Z' },
		limit: 50,
		timezone: 'UTC',
	},
}

describe('buildQueryUrl', () => {
	it('encodes every field in the documented order', () => {
		const url = buildQueryUrl('/api', {
			metrics: ['pageviews', 'visitors'],
			dimensions: ['page'],
			from: '2026-09-01',
			to: '2026-09-07',
			granularity: 'day',
			filters: [{ dimension: 'page', operator: 'eq', value: '/' }],
			limit: 25,
			order: { metric: 'pageviews', direction: 'desc' },
			compare: 'previous',
			source: 'native',
			path: '/blog',
			hostname: 'example.com',
			timezone: 'UTC',
		})

		expect(url).toBe(
			'/api/analytics/query?metrics=pageviews%2Cvisitors&dimensions=page&from=2026-09-01' +
				'&to=2026-09-07&granularity=day&filters=%5B%7B%22dimension%22%3A%22page%22%2C%22operator' +
				'%22%3A%22eq%22%2C%22value%22%3A%22%2F%22%7D%5D&limit=25&order=pageviews%3Adesc' +
				'&compare=previous&source=native&path=%2Fblog&hostname=example.com&timezone=UTC'
		)
	})

	it('joins multi-value fields with commas', () => {
		const url = buildQueryUrl('/api', {
			...baseRequest,
			metrics: ['pageviews', 'visitors', 'sessions'],
			dimensions: ['page', 'referrer'],
		})

		const params = new URL(url, 'http://localhost').searchParams
		expect(params.get('metrics')).toBe('pageviews,visitors,sessions')
		expect(params.get('dimensions')).toBe('page,referrer')
	})

	it('omits every optional field left undefined', () => {
		const url = buildQueryUrl('/api', baseRequest)
		const params = new URL(url, 'http://localhost').searchParams

		expect([...params.keys()]).toEqual(['metrics', 'from', 'to'])
		expect(params.has('compare')).toBe(false)
		expect(params.has('filters')).toBe(false)
		expect(params.has('order')).toBe(false)
	})

	it('omits compare unless explicitly set', () => {
		const url = buildQueryUrl('/api', baseRequest)
		expect(url).not.toContain('compare')
	})

	it('encodes filters as a JSON array', () => {
		const url = buildQueryUrl('/api', {
			...baseRequest,
			filters: [
				{ dimension: 'page', operator: 'eq', value: '/pricing' },
				{ dimension: 'referrer', operator: 'contains', value: 'google' },
			],
		})
		const params = new URL(url, 'http://localhost').searchParams
		expect(JSON.parse(params.get('filters') ?? '')).toEqual([
			{ dimension: 'page', operator: 'eq', value: '/pricing' },
			{ dimension: 'referrer', operator: 'contains', value: 'google' },
		])
	})

	it('formats order as metric:direction', () => {
		const url = buildQueryUrl('/api', {
			...baseRequest,
			order: { metric: 'pageviews', direction: 'asc' },
		})
		const params = new URL(url, 'http://localhost').searchParams
		expect(params.get('order')).toBe('pageviews:asc')
	})

	it('builds a deterministic URL regardless of the request object key order', () => {
		const a: QueryRequest = {
			metrics: ['pageviews'],
			from: '2026-09-01',
			to: '2026-09-07',
			timezone: 'UTC',
			source: 'native',
		}
		// Same values, keys assigned in a different order at construction time.
		const b: QueryRequest = {
			source: 'native',
			timezone: 'UTC',
			to: '2026-09-07',
			from: '2026-09-01',
			metrics: ['pageviews'],
		}

		expect(buildQueryUrl('/api', a)).toBe(buildQueryUrl('/api', b))
	})
})

describe('fetchQuery', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('requests with credentials included and an Accept header', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))

		await fetchQuery('/api', baseRequest)

		expect(fetch).toHaveBeenCalledTimes(1)
		const [, init] = vi.mocked(fetch).mock.calls[0] ?? []
		expect(init).toMatchObject({ credentials: 'include' })
		const headers = new Headers((init as RequestInit).headers)
		expect(headers.get('Accept')).toBe('application/json')
	})

	it('dedupes two concurrent identical calls into one fetch', async () => {
		let settle: (() => void) | undefined
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settle = () => resolve(okResponse(sampleResult))
				})
		)

		const first = fetchQuery('/api', baseRequest)
		const second = fetchQuery('/api', baseRequest)
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		const [firstResult, secondResult] = await Promise.all([first, second])
		expect(firstResult).toEqual(sampleResult)
		expect(secondResult).toEqual(sampleResult)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('refetches on a later call after the first settled', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))

		await fetchQuery('/api', baseRequest)
		await fetchQuery('/api', baseRequest)

		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('clears the in-flight entry on failure so a retry refetches', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			errorResponse(500, { error: { code: 'internal', message: 'x' } })
		)
		vi.mocked(fetch).mockResolvedValueOnce(okResponse(sampleResult))

		await expect(fetchQuery('/api', baseRequest)).rejects.toThrow(QueryFetchError)
		await expect(fetchQuery('/api', baseRequest)).resolves.toEqual(sampleResult)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it("rejects the caller's promise on abort without cancelling a shared fetch for another caller", async () => {
		let settle: (() => void) | undefined
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settle = () => resolve(okResponse(sampleResult))
				})
		)

		const controller = new AbortController()
		const aborted = fetchQuery('/api', baseRequest, { signal: controller.signal })
		const other = fetchQuery('/api', baseRequest)

		controller.abort(new Error('cancelled'))
		await expect(aborted).rejects.toThrow('cancelled')

		settle?.()
		await expect(other).resolves.toEqual(sampleResult)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('rejects immediately when the signal is already aborted', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))
		const controller = new AbortController()
		controller.abort(new Error('pre-aborted'))

		await expect(fetchQuery('/api', baseRequest, { signal: controller.signal })).rejects.toThrow(
			'pre-aborted'
		)
	})

	it('throws QueryFetchError with the parsed endpoint error body on a 400', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(400, {
				error: { code: 'invalid_param', message: 'metrics is required', param: 'metrics' },
			})
		)

		const failure = fetchQuery('/api', baseRequest)
		await expect(failure).rejects.toThrow(QueryFetchError)
		try {
			await failure
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			expect(err).toBeInstanceOf(QueryFetchError)
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(400)
			expect(queryErr.error).toEqual({
				code: 'invalid_param',
				message: 'metrics is required',
				param: 'metrics',
			})
		}
	})

	it('reads Retry-After on a 503', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(
				503,
				{ error: { code: 'unavailable', message: 'analytics: source is temporarily unavailable' } },
				{ 'Retry-After': '30' }
			)
		)

		try {
			await fetchQuery('/api', baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(503)
			expect(queryErr.retryAfter).toBe(30)
		}
	})

	it('leaves error undefined for a non-JSON error body', async () => {
		vi.mocked(fetch).mockResolvedValue(errorResponse(500, undefined))

		try {
			await fetchQuery('/api', baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(500)
			expect(queryErr.error).toBeUndefined()
		}
	})

	it('propagates a network failure unchanged', async () => {
		const networkError = new TypeError('fetch failed')
		vi.mocked(fetch).mockRejectedValue(networkError)

		await expect(fetchQuery('/api', baseRequest)).rejects.toBe(networkError)
	})
})
