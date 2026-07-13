import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { turnstileProvider } from './turnstile'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const reqWith = (headers: Record<string, string> = {}): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

describe('turnstileProvider', () => {
	it('sends a form-encoded body with secret, response, and the first-hop remoteip', async () => {
		let body: URLSearchParams | undefined
		server.use(
			http.post(VERIFY_URL, async ({ request }) => {
				expect(request.headers.get('content-type')).toContain('application/x-www-form-urlencoded')
				body = new URLSearchParams(await request.text())
				return HttpResponse.json({ success: true })
			})
		)
		const provider = turnstileProvider({ secretKey: 'sec' })
		const passed = await provider.verify({
			token: 'tok',
			req: reqWith({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }),
		})
		expect(passed).toBe(true)
		expect(body?.get('secret')).toBe('sec')
		expect(body?.get('response')).toBe('tok')
		expect(body?.get('remoteip')).toBe('1.2.3.4')
	})

	it('omits remoteip when the IP header is absent', async () => {
		let body: URLSearchParams | undefined
		server.use(
			http.post(VERIFY_URL, async ({ request }) => {
				body = new URLSearchParams(await request.text())
				return HttpResponse.json({ success: true })
			})
		)
		const provider = turnstileProvider({ secretKey: 'sec' })
		await provider.verify({ token: 'tok', req: reqWith() })
		expect(body?.has('remoteip')).toBe(false)
	})

	it('reads the client IP from a custom ipHeader', async () => {
		let body: URLSearchParams | undefined
		server.use(
			http.post(VERIFY_URL, async ({ request }) => {
				body = new URLSearchParams(await request.text())
				return HttpResponse.json({ success: true })
			})
		)
		const provider = turnstileProvider({ secretKey: 'sec', ipHeader: 'cf-connecting-ip' })
		await provider.verify({ token: 'tok', req: reqWith({ 'cf-connecting-ip': '9.9.9.9' }) })
		expect(body?.get('remoteip')).toBe('9.9.9.9')
	})

	it('fails on success:false with error codes', async () => {
		server.use(
			http.post(VERIFY_URL, () =>
				HttpResponse.json({ success: false, 'error-codes': ['invalid-input-response'] })
			)
		)
		const provider = turnstileProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'bad', req: reqWith() })).toBe(false)
	})

	it('fails closed on a non-2xx response', async () => {
		server.use(http.post(VERIFY_URL, () => new HttpResponse(null, { status: 500 })))
		const provider = turnstileProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(false)
	})

	it('fails closed on a network error', async () => {
		server.use(http.post(VERIFY_URL, () => HttpResponse.error()))
		const provider = turnstileProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(false)
	})

	it('fails closed on timeout', async () => {
		server.use(
			http.post(VERIFY_URL, async () => {
				await delay(500)
				return HttpResponse.json({ success: true })
			})
		)
		const provider = turnstileProvider({ secretKey: 'sec', timeoutMs: 50 })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(false)
	})

	it('supports a custom verifyUrl', async () => {
		server.use(
			http.post('https://verify.test/siteverify', () => HttpResponse.json({ success: true }))
		)
		const provider = turnstileProvider({
			secretKey: 'sec',
			verifyUrl: 'https://verify.test/siteverify',
		})
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(true)
	})
})
