import { describe, expect, it, vi } from 'vitest'

import { callTenx } from './tenx'

const options = { url: 'https://tenx.example', apiKey: 'rec_secret' }

const respond = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('callTenx', () => {
	it('sends the key as a bearer token to the ingest path', async () => {
		const fetchImpl = respond(200, { ok: true })
		const result = await callTenx({
			options,
			path: '/ping',
			method: 'GET',
			timeoutMs: 1000,
			fetchImpl,
		})
		expect(result).toEqual({ ok: true, status: 200, body: { ok: true } })
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('https://tenx.example/api/ingest/v1/ping')
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer rec_secret')
	})

	it('does not call out without a url and key', async () => {
		const fetchImpl = respond(200, {})
		const result = await callTenx({
			options: { url: null, apiKey: null },
			path: '/ping',
			method: 'GET',
			timeoutMs: 1000,
			fetchImpl,
		})
		expect(result).toEqual({ ok: false, status: 503, error: 'notConfigured' })
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('reports a rejected key as a bad gateway, not as the browser being unauthorized', async () => {
		const result = await callTenx({
			options,
			path: '/ping',
			method: 'GET',
			timeoutMs: 1000,
			fetchImpl: respond(401, { error: 'nope' }),
		})
		expect(result).toMatchObject({ ok: false, status: 502, error: 'keyRejected' })
	})

	it('passes other refusals through with their status and body', async () => {
		const result = await callTenx({
			options,
			path: '/clips/1/complete',
			method: 'POST',
			timeoutMs: 1000,
			fetchImpl: respond(409, { error: 'already complete' }),
		})
		expect(result).toEqual({
			ok: false,
			status: 409,
			error: 'refused',
			body: { error: 'already complete' },
		})
	})

	it('turns a network failure into unreachable and a timeout into timeout', async () => {
		const failing = vi.fn(async () => {
			throw new TypeError('fetch failed')
		})
		expect(
			await callTenx({ options, path: '/ping', method: 'GET', timeoutMs: 1000, fetchImpl: failing })
		).toEqual({ ok: false, status: 504, error: 'unreachable' })

		const slow = vi.fn(async () => {
			throw new DOMException('timed out', 'TimeoutError')
		})
		expect(
			await callTenx({ options, path: '/ping', method: 'GET', timeoutMs: 1000, fetchImpl: slow })
		).toEqual({ ok: false, status: 504, error: 'timeout' })
	})
})
