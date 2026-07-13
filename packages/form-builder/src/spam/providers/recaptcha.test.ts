import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { recaptchaProvider } from './recaptcha'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'

const req = { headers: new Headers() } as unknown as PayloadRequest

const respond = (json: Record<string, unknown>) =>
	server.use(http.post(VERIFY_URL, () => HttpResponse.json(json)))

describe('recaptchaProvider', () => {
	it('sends a form-encoded body with secret and response', async () => {
		let body: URLSearchParams | undefined
		server.use(
			http.post(VERIFY_URL, async ({ request }) => {
				body = new URLSearchParams(await request.text())
				return HttpResponse.json({ success: true })
			})
		)
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(true)
		expect(body?.get('secret')).toBe('sec')
		expect(body?.get('response')).toBe('tok')
	})

	it('passes a v2 response (no score) on success alone', async () => {
		respond({ success: true, challenge_ts: '2026-07-13T00:00:00Z', hostname: 'example.com' })
		const provider = recaptchaProvider({ secretKey: 'sec', minScore: 0.9 })
		expect(await provider.verify({ token: 'tok', req })).toBe(true)
	})

	it('fails on success:false with error codes', async () => {
		respond({ success: false, 'error-codes': ['timeout-or-duplicate'] })
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(false)
	})

	it('fails a v3 response below the default 0.5 score threshold', async () => {
		respond({ success: true, score: 0.3, action: 'submit' })
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(false)
	})

	it('passes a v3 response at or above the default threshold', async () => {
		respond({ success: true, score: 0.5 })
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(true)
	})

	it('respects a custom minScore', async () => {
		respond({ success: true, score: 0.7 })
		const provider = recaptchaProvider({ secretKey: 'sec', minScore: 0.8 })
		expect(await provider.verify({ token: 'tok', req })).toBe(false)
	})

	it('fails closed on a non-2xx response', async () => {
		server.use(http.post(VERIFY_URL, () => new HttpResponse(null, { status: 502 })))
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(false)
	})

	it('fails closed on a network error', async () => {
		server.use(http.post(VERIFY_URL, () => HttpResponse.error()))
		const provider = recaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req })).toBe(false)
	})
})
