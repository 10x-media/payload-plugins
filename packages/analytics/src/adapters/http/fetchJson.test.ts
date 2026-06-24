import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fetchJson } from './fetchJson'

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
})
