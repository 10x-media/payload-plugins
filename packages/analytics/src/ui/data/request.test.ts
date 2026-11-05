import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsErrorCode } from '../../plugin/errors'
import { failureOf, isAbortError, QueryFetchError, requestJson } from './request'

describe('requestJson', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	const init = (): RequestInit => vi.mocked(fetch).mock.calls[0]?.[1] ?? {}

	it('reads with same-origin credentials and asks for JSON', async () => {
		vi.mocked(fetch).mockResolvedValue(Response.json({ ok: 1 }))

		await expect(requestJson('/api/_x/sources')).resolves.toEqual({ ok: 1 })

		expect(init()).toMatchObject({ method: 'GET', credentials: 'same-origin' })
		expect(new Headers(init().headers).get('Accept')).toBe('application/json')
		expect(init().body).toBeUndefined()
	})

	it('sends a body as JSON', async () => {
		vi.mocked(fetch).mockResolvedValue(Response.json({ epoch: '1' }))

		await requestJson('/api/_x/refresh', { method: 'POST', body: { scope: 'acme' } })

		expect(init().method).toBe('POST')
		expect(new Headers(init().headers).get('Content-Type')).toBe('application/json')
		expect(JSON.parse(String(init().body))).toEqual({ scope: 'acme' })
	})

	it('throws the envelope of a refusal as a typed error, with its code, status and wait', async () => {
		vi.mocked(fetch).mockResolvedValue(
			Response.json(
				{ error: { code: 'rate_limited', message: 'busy' } },
				{ status: 429, headers: { 'Retry-After': '4.6' } }
			)
		)

		const err = await requestJson('/api/_x/query').catch((caught: unknown) => caught)

		expect(err).toBeInstanceOf(QueryFetchError)
		expect(err).toMatchObject({
			status: 429,
			code: 'rate_limited',
			retryAfter: 4,
			error: { code: 'rate_limited', message: 'busy' },
		})
	})

	it('leaves the code out of a body that is not the envelope, keeping the status', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))

		const err = await requestJson('/api/_x/query').catch((caught: unknown) => caught)

		expect(err).toBeInstanceOf(QueryFetchError)
		expect(err).toMatchObject({ status: 502 })
		expect((err as QueryFetchError).code).toBeUndefined()
	})

	it('hands the abort signal to the fetch, and an abort rejects as itself', async () => {
		const controller = new AbortController()
		vi.mocked(fetch).mockImplementation(
			(_url, options) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener('abort', () => {
						reject(options.signal?.reason)
					})
				})
		)

		const pending = requestJson('/api/_x/query', { signal: controller.signal })
		controller.abort()

		const err = await pending.catch((caught: unknown) => caught)
		expect(init().signal).toBe(controller.signal)
		expect(isAbortError(err)).toBe(true)
		expect(failureOf(err)).toEqual({ code: 'failed' })
	})

	it('lets a network failure through unchanged', async () => {
		const down = new TypeError('fetch failed')
		vi.mocked(fetch).mockRejectedValue(down)

		await expect(requestJson('/api/_x/query')).rejects.toBe(down)
	})
})

describe('failureOf', () => {
	const refusal = (
		status: number,
		code?: AnalyticsErrorCode,
		extra: { param?: string; retryAfter?: number } = {}
	) =>
		new QueryFetchError(
			status,
			code === undefined
				? undefined
				: { code, message: 'x', ...(extra.param === undefined ? {} : { param: extra.param }) },
			extra.retryAfter
		)

	it('reads every refusal of the read as asked as invalid_param, with the parameter at fault', () => {
		expect(failureOf(refusal(400, 'invalid_param', { param: 'filters' }))).toEqual({
			code: 'invalid_param',
			param: 'filters',
		})
		const asked: AnalyticsErrorCode[] = [
			'unsupported_metric',
			'unsupported_dimension',
			'unsupported_filter',
			'unsupported_operator',
			'unsupported_granularity',
		]
		for (const code of asked) {
			expect(failureOf(refusal(400, code)).code).toBe('invalid_param')
		}
	})

	it('tells a range over the cap from other refusals, so it is worded as such', () => {
		expect(failureOf(refusal(400, 'range_too_long', { param: 'to' }))).toEqual({
			code: 'range_too_long',
		})
	})

	it('tells a refused host from the settings in general', () => {
		expect(failureOf(refusal(502, 'source_misconfigured', { param: 'host' }))).toEqual({
			code: 'source_misconfigured',
			hostRefused: true,
		})
		expect(failureOf(refusal(502, 'source_misconfigured', { param: 'source' }))).toEqual({
			code: 'source_misconfigured',
			hostRefused: false,
		})
	})

	it('carries the wait of an outage and of a full queue', () => {
		expect(failureOf(refusal(503, 'unavailable', { retryAfter: 30 }))).toEqual({
			code: 'unavailable',
			retryAfter: 30,
		})
		expect(failureOf(refusal(429, 'rate_limited', { retryAfter: 2 }))).toEqual({
			code: 'rate_limited',
			retryAfter: 2,
		})
	})

	it('reads a vanished source and a refused reader by code', () => {
		expect(failureOf(refusal(404, 'unknown_source'))).toEqual({ code: 'not_found' })
		expect(failureOf(refusal(404, 'not_found'))).toEqual({ code: 'not_found' })
		expect(failureOf(refusal(403, 'forbidden'))).toEqual({ code: 'forbidden' })
		expect(failureOf(refusal(400, 'untrusted_scope'))).toEqual({ code: 'forbidden' })
	})

	it('falls back to the status for an answer without a code', () => {
		expect(failureOf(refusal(403))).toEqual({ code: 'forbidden' })
		expect(failureOf(refusal(404))).toEqual({ code: 'not_found' })
		expect(failureOf(refusal(429, undefined, { retryAfter: 5 }))).toEqual({
			code: 'rate_limited',
			retryAfter: 5,
		})
		expect(failureOf(refusal(503))).toEqual({ code: 'unavailable' })
		expect(failureOf(refusal(502))).toEqual({ code: 'failed' })
		expect(failureOf(refusal(500, 'internal'))).toEqual({ code: 'failed' })
	})

	it('reads anything that is not a refusal as a plain failure', () => {
		expect(failureOf(new TypeError('fetch failed'))).toEqual({ code: 'failed' })
		expect(failureOf('nope')).toEqual({ code: 'failed' })
	})
})
