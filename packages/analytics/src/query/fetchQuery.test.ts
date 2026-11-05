import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	buildQueryUrl,
	fetchQuery,
	QueryFetchError,
	type QueryRequest,
	refreshCache,
} from './fetchQuery'
import type { QueryResponse } from './response'

const QUERY = '/api/_x/query'
const REFRESH = '/api/_x/refresh'

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
		filters: {},
		minGranularity: 'day',
		comparison: false,
		realtime: false,
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
		const url = buildQueryUrl(QUERY, {
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
			scope: 'tenant-a',
			path: '/blog',
			hostname: 'example.com',
			timezone: 'UTC',
		})

		expect(url).toBe(
			'/api/_x/query?metrics=pageviews%2Cvisitors&dimensions=page&from=2026-09-01' +
				'&to=2026-09-07&granularity=day&filters=%5B%7B%22dimension%22%3A%22page%22%2C%22operator' +
				'%22%3A%22eq%22%2C%22value%22%3A%22%2F%22%7D%5D&limit=25&order=pageviews%3Adesc' +
				'&compare=previous&source=native&scope=tenant-a&path=%2Fblog&hostname=example.com&timezone=UTC'
		)
	})

	it('encodes the preset the days came from after every other field, and omits it otherwise', () => {
		const url = buildQueryUrl(QUERY, { ...baseRequest, timezone: 'UTC', timeframe: 'last7days' })
		expect(url.endsWith('&timezone=UTC&timeframe=last7days')).toBe(true)
		const without = new URL(buildQueryUrl(QUERY, baseRequest), 'http://localhost').searchParams
		expect(without.has('timeframe')).toBe(false)
	})

	it('encodes an item ref when set and omits it otherwise', () => {
		const withItem = new URL(
			buildQueryUrl(QUERY, { ...baseRequest, item: 'offers:12' }),
			'http://localhost'
		).searchParams
		expect(withItem.get('item')).toBe('offers:12')
		const without = new URL(buildQueryUrl(QUERY, baseRequest), 'http://localhost').searchParams
		expect(without.has('item')).toBe(false)
	})

	it('encodes scope when set and omits it otherwise', () => {
		const withScope = new URL(
			buildQueryUrl(QUERY, { ...baseRequest, scope: 'tenant-a' }),
			'http://localhost'
		).searchParams
		expect(withScope.get('scope')).toBe('tenant-a')

		const without = new URL(buildQueryUrl(QUERY, baseRequest), 'http://localhost').searchParams
		expect(without.has('scope')).toBe(false)
	})

	it('reads from the endpoint it is handed, wherever the install mounted it', () => {
		expect(buildQueryUrl('/cms/api/stats/query', baseRequest)).toMatch(
			/^\/cms\/api\/stats\/query\?metrics=pageviews&/
		)
		expect(buildQueryUrl('https://cms.example/api/_x/query/', baseRequest)).toMatch(
			/^https:\/\/cms\.example\/api\/_x\/query\?metrics=/
		)
	})

	it("reads the API route alone as the default mount's endpoint", () => {
		expect(buildQueryUrl('/api', baseRequest)).toMatch(/^\/api\/_x\/query\?metrics=pageviews&/)
		expect(buildQueryUrl('/cms/api/', baseRequest)).toMatch(/^\/cms\/api\/_x\/query\?/)
		expect(buildQueryUrl('https://cms.example/api', baseRequest)).toMatch(
			/^https:\/\/cms\.example\/api\/_x\/query\?/
		)
	})

	it('joins multi-value fields with commas', () => {
		const url = buildQueryUrl(QUERY, {
			...baseRequest,
			metrics: ['pageviews', 'visitors', 'sessions'],
			dimensions: ['page', 'referrer'],
		})

		const params = new URL(url, 'http://localhost').searchParams
		expect(params.get('metrics')).toBe('pageviews,visitors,sessions')
		expect(params.get('dimensions')).toBe('page,referrer')
	})

	it('omits every optional field left undefined', () => {
		const url = buildQueryUrl(QUERY, baseRequest)
		const params = new URL(url, 'http://localhost').searchParams

		expect([...params.keys()]).toEqual(['metrics', 'from', 'to'])
		expect(params.has('compare')).toBe(false)
		expect(params.has('filters')).toBe(false)
		expect(params.has('order')).toBe(false)
	})

	it('omits compare unless explicitly set', () => {
		const url = buildQueryUrl(QUERY, baseRequest)
		expect(url).not.toContain('compare')
	})

	it('encodes filters as a JSON array', () => {
		const url = buildQueryUrl(QUERY, {
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
		const url = buildQueryUrl(QUERY, {
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

		expect(buildQueryUrl(QUERY, a)).toBe(buildQueryUrl(QUERY, b))
	})
})

describe('fetchQuery', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('requests with same-origin credentials and an Accept header', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))

		await fetchQuery(QUERY, baseRequest)

		expect(fetch).toHaveBeenCalledTimes(1)
		const [, init] = vi.mocked(fetch).mock.calls[0] ?? []
		expect(init).toMatchObject({ credentials: 'same-origin' })
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

		const first = fetchQuery(QUERY, baseRequest)
		const second = fetchQuery(QUERY, baseRequest)
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		const [firstResult, secondResult] = await Promise.all([first, second])
		expect(firstResult).toEqual(sampleResult)
		expect(secondResult).toEqual(sampleResult)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('refuses a 2xx answer that is not a query response, like a failed read', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(okResponse({ result: { rows: 'none' } }))

		await expect(fetchQuery(QUERY, baseRequest)).rejects.toThrow(
			'analytics: /api/_x/query answered in an unexpected shape'
		)
	})

	it('refetches on a later call after the first settled', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))

		await fetchQuery(QUERY, baseRequest)
		await fetchQuery(QUERY, baseRequest)

		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('clears the in-flight entry on failure so a retry refetches', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			errorResponse(500, { error: { code: 'internal', message: 'x' } })
		)
		vi.mocked(fetch).mockResolvedValueOnce(okResponse(sampleResult))

		await expect(fetchQuery(QUERY, baseRequest)).rejects.toThrow(QueryFetchError)
		await expect(fetchQuery(QUERY, baseRequest)).resolves.toEqual(sampleResult)
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
		const aborted = fetchQuery(QUERY, baseRequest, { signal: controller.signal })
		const other = fetchQuery(QUERY, baseRequest)

		controller.abort(new Error('cancelled'))
		await expect(aborted).rejects.toThrow('cancelled')

		settle?.()
		await expect(other).resolves.toEqual(sampleResult)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	// A tenant switch mid-read: the same URL, asked for another scope, must not join the first
	// tenant's fetch and answer with its numbers.
	it('never shares a fetch between two scopes reading the same URL', async () => {
		const settles: Array<(body: QueryResponse) => void> = []
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settles.push((body) => resolve(okResponse(body)))
				})
		)
		const forTenant = (tenant: string): QueryResponse => ({
			...sampleResult,
			result: { ...sampleResult.result, totals: { pageviews: tenant === 'a' ? 1 : 2 } },
		})

		const first = fetchQuery(QUERY, baseRequest, { scope: 'tenant-a' })
		const second = fetchQuery(QUERY, baseRequest, { scope: 'tenant-b' })
		const again = fetchQuery(QUERY, baseRequest, { scope: 'tenant-b' })
		expect(fetch).toHaveBeenCalledTimes(2)

		settles[1]?.(forTenant('b'))
		settles[0]?.(forTenant('a'))
		expect((await second).result.totals).toEqual({ pageviews: 2 })
		expect((await again).result.totals).toEqual({ pageviews: 2 })
		expect((await first).result.totals).toEqual({ pageviews: 1 })
	})

	it('aborts the shared fetch once every caller sharing it has aborted', async () => {
		const signals: AbortSignal[] = []
		vi.mocked(fetch).mockImplementation((_url, init) => {
			const signal = init?.signal
			if (signal) {
				signals.push(signal)
			}
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(new DOMException('gone', 'AbortError')))
			})
		})
		const one = new AbortController()
		const two = new AbortController()
		const first = fetchQuery(QUERY, baseRequest, { signal: one.signal })
		const second = fetchQuery(QUERY, baseRequest, { signal: two.signal })
		expect(fetch).toHaveBeenCalledTimes(1)

		one.abort(new Error('first left'))
		await expect(first).rejects.toThrow('first left')
		expect(signals[0]?.aborted).toBe(false)

		two.abort(new Error('second left'))
		await expect(second).rejects.toThrow('second left')
		expect(signals[0]?.aborted).toBe(true)

		// The aborted fetch is gone: the next identical read starts its own.
		const three = new AbortController()
		const third = fetchQuery(QUERY, baseRequest, { signal: three.signal })
		expect(fetch).toHaveBeenCalledTimes(2)
		three.abort(new Error('third left'))
		await expect(third).rejects.toThrow('third left')
	})

	it('keeps the shared fetch running for a caller that brought no signal', async () => {
		let settle: (() => void) | undefined
		const signals: AbortSignal[] = []
		vi.mocked(fetch).mockImplementation((_url, init) => {
			if (init?.signal) {
				signals.push(init.signal)
			}
			return new Promise<Response>((resolve) => {
				settle = () => resolve(okResponse(sampleResult))
			})
		})
		const controller = new AbortController()
		const aborted = fetchQuery(QUERY, baseRequest, { signal: controller.signal })
		const held = fetchQuery(QUERY, baseRequest)

		controller.abort(new Error('left'))
		await expect(aborted).rejects.toThrow('left')
		expect(signals[0]?.aborted).toBe(false)
		settle?.()
		await expect(held).resolves.toEqual(sampleResult)
	})

	it('rejects immediately when the signal is already aborted', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse(sampleResult))
		const controller = new AbortController()
		controller.abort(new Error('pre-aborted'))

		await expect(fetchQuery(QUERY, baseRequest, { signal: controller.signal })).rejects.toThrow(
			'pre-aborted'
		)
	})

	it('throws QueryFetchError with the parsed endpoint error body on a 400', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(400, {
				error: { code: 'invalid_param', message: 'metrics is required', param: 'metrics' },
			})
		)

		const failure = fetchQuery(QUERY, baseRequest)
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

	it("leaves error undefined for another endpoint's flat string error body", async () => {
		vi.mocked(fetch).mockResolvedValue(errorResponse(403, { error: 'forbidden' }))

		try {
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(403)
			expect(queryErr.error).toBeUndefined()
			expect(queryErr.message).toContain('403')
		}
	})

	it('leaves error undefined for a code no release of this package ever sent', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(418, { error: { code: 'teapot', message: 'short and stout' } })
		)

		try {
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(418)
			expect(queryErr.error).toBeUndefined()
		}
	})

	it('leaves error undefined for an error object missing code or message', async () => {
		vi.mocked(fetch).mockResolvedValue(errorResponse(400, { error: { code: 'invalid_param' } }))

		try {
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			expect((err as QueryFetchError).error).toBeUndefined()
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
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(503)
			expect(queryErr.retryAfter).toBe(30)
		}
	})

	it('leaves retryAfter undefined for a Retry-After HTTP-date', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(
				503,
				{ error: { code: 'unavailable', message: 'down' } },
				{ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }
			)
		)

		try {
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			expect((err as QueryFetchError).retryAfter).toBeUndefined()
		}
	})

	it('floors a fractional Retry-After to whole seconds', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(
				503,
				{ error: { code: 'unavailable', message: 'down' } },
				{ 'Retry-After': '30.5' }
			)
		)

		try {
			await fetchQuery(QUERY, baseRequest)
			throw new Error('expected fetchQuery to reject')
		} catch (err) {
			expect((err as QueryFetchError).retryAfter).toBe(30)
		}
	})

	it('leaves error undefined for a non-JSON error body', async () => {
		vi.mocked(fetch).mockResolvedValue(errorResponse(500, undefined))

		try {
			await fetchQuery(QUERY, baseRequest)
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

		await expect(fetchQuery(QUERY, baseRequest)).rejects.toBe(networkError)
	})
})

describe('refreshCache', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('posts to the refresh path with credentials and answers the new epoch', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 'mfa1-9c2b' }))

		await expect(refreshCache(REFRESH)).resolves.toEqual({ epoch: 'mfa1-9c2b' })

		const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
		expect(url).toBe('/api/_x/refresh')
		expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
		expect(new Headers((init as RequestInit).headers).get('Accept')).toBe('application/json')
	})

	it('reports an answer it cannot read as the initial token rather than a typed lie', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 4 }))

		await expect(refreshCache(REFRESH)).resolves.toEqual({ epoch: '0' })
	})

	it('posts to the endpoint it is handed, wherever the install mounted it', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 'mfa1-0001' }))

		await refreshCache('/cms/api/stats/refresh')

		expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/cms/api/stats/refresh')
	})

	it('posts to the default mount for the API route alone', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 'mfa1-0001' }))

		await refreshCache('/api')

		expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/_x/refresh')
	})

	it('carries a named scope in the body and omits it otherwise', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 'mfa1-0001' }))

		await refreshCache(REFRESH, { scope: 'tenant-b' })
		const scoped = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body
		expect(JSON.parse(String(scoped))).toEqual({ scope: 'tenant-b' })

		await refreshCache(REFRESH)
		const bare = (vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).body
		expect(JSON.parse(String(bare))).toEqual({})
	})

	it('hands the abort signal straight to the fetch', async () => {
		vi.mocked(fetch).mockResolvedValue(okResponse({ epoch: 'mfa1-0001' }))
		const controller = new AbortController()

		await refreshCache(REFRESH, { signal: controller.signal })

		expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal)
	})

	it('throws QueryFetchError with the endpoint error body on a refusal', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(400, {
				error: { code: 'untrusted_scope', message: 'analytics: scope', param: 'scope' },
			})
		)

		try {
			await refreshCache(REFRESH, { scope: 'tenant-b' })
			throw new Error('expected refreshCache to reject')
		} catch (err) {
			expect(err).toBeInstanceOf(QueryFetchError)
			const queryErr = err as QueryFetchError
			expect(queryErr.status).toBe(400)
			expect(queryErr.error?.code).toBe('untrusted_scope')
		}
	})

	it('reads Retry-After off a 503 like a failed read does', async () => {
		vi.mocked(fetch).mockResolvedValue(
			errorResponse(
				503,
				{ error: { code: 'unavailable', message: 'down' } },
				{ 'Retry-After': '30' }
			)
		)

		try {
			await refreshCache(REFRESH)
			throw new Error('expected refreshCache to reject')
		} catch (err) {
			expect((err as QueryFetchError).retryAfter).toBe(30)
		}
	})
})
