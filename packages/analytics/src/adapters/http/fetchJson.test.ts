import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BREAKER_MAX_MS } from '../../surfacing/breaker'
import { fetchJson, parseRetryAfter } from './fetchJson'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('fetchJson', () => {
	it('GETs and parses JSON', async () => {
		server.use(http.get('https://x.test/data', () => HttpResponse.json({ ok: 1 })))
		expect(await fetchJson<{ ok: number }>('https://x.test/data', { provider: 'x' })).toEqual({
			ok: 1,
		})
	})

	it('POSTs a JSON body with the content-type header', async () => {
		server.use(
			http.post('https://x.test/q', async ({ request }) => {
				expect(request.headers.get('content-type')).toContain('application/json')
				expect(await request.json()).toEqual({ a: 1 })
				return HttpResponse.json({ got: true })
			})
		)
		expect(
			await fetchJson('https://x.test/q', { method: 'POST', body: { a: 1 }, provider: 'x' })
		).toEqual({
			got: true,
		})
	})

	it('forwards custom headers', async () => {
		server.use(
			http.get('https://x.test/auth', ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer k')
				return HttpResponse.json({})
			})
		)
		await fetchJson('https://x.test/auth', {
			provider: 'x',
			headers: { authorization: 'Bearer k' },
		})
	})

	it('sends through the fetch it is handed instead of the global one', async () => {
		const seen: Array<{ url: string; method?: string; body?: unknown }> = []
		const result = await fetchJson<{ via: string }>('https://x.test/guarded', {
			provider: 'x',
			method: 'POST',
			body: { a: 1 },
			fetch: async (input, init) => {
				seen.push({ url: String(input), method: init?.method, body: init?.body })
				return Response.json({ via: 'handed' })
			},
		})
		expect(result).toEqual({ via: 'handed' })
		expect(seen).toEqual([{ url: 'https://x.test/guarded', method: 'POST', body: '{"a":1}' }])
	})

	it('throws ProviderHttpError with the status on a non-2xx response', async () => {
		server.use(http.get('https://x.test/boom', () => HttpResponse.text('nope', { status: 429 })))
		await expect(fetchJson('https://x.test/boom', { provider: 'plausible' })).rejects.toMatchObject(
			{
				name: 'ProviderHttpError',
				status: 429,
				provider: 'plausible',
			}
		)
	})

	it("carries the vendor's Retry-After on the error, in milliseconds", async () => {
		server.use(
			http.get('https://x.test/busy', () =>
				HttpResponse.text('busy', { status: 503, headers: { 'retry-after': '7' } })
			)
		)
		await expect(fetchJson('https://x.test/busy', { provider: 'umami' })).rejects.toMatchObject({
			status: 503,
			retryAfterMs: 7000,
		})
	})

	it('leaves retryAfterMs off an error answered without the header', async () => {
		server.use(http.get('https://x.test/plain', () => HttpResponse.text('', { status: 500 })))
		const err: unknown = await fetchJson('https://x.test/plain', { provider: 'x' }).catch(
			(caught: unknown) => caught
		)
		expect(err).toMatchObject({ status: 500, retryAfterMs: undefined })
	})
})

describe('parseRetryAfter', () => {
	const now = Date.parse('2026-10-07T12:00:00.000Z')

	it('reads whole seconds and an HTTP date, a date already past as no wait', () => {
		expect(parseRetryAfter('120', now)).toBe(120_000)
		expect(parseRetryAfter(' 0 ', now)).toBe(0)
		expect(parseRetryAfter('Wed, 07 Oct 2026 12:00:30 GMT', now)).toBe(30_000)
		expect(parseRetryAfter('Wed, 07 Oct 2026 11:00:00 GMT', now)).toBe(0)
	})

	it('reads anything else as absent', () => {
		for (const value of [null, undefined, '', '1.5', '-3', 'soon']) {
			expect(parseRetryAfter(value, now)).toBeUndefined()
		}
	})

	it('caps a wait at the breaker’s longest, a number too long to read included', () => {
		expect(parseRetryAfter('86400', now)).toBe(BREAKER_MAX_MS)
		expect(parseRetryAfter('9'.repeat(400), now)).toBe(BREAKER_MAX_MS)
		expect(parseRetryAfter('Thu, 08 Oct 2026 12:00:00 GMT', now)).toBe(BREAKER_MAX_MS)
	})
})
