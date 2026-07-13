import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { PayloadRequest } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { hcaptchaProvider } from './hcaptcha'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const VERIFY_URL = 'https://api.hcaptcha.com/siteverify'

const reqWith = (headers: Record<string, string> = {}): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

describe('hcaptchaProvider', () => {
	it('sends a form-encoded body with secret, response, and remoteip', async () => {
		let body: URLSearchParams | undefined
		server.use(
			http.post(VERIFY_URL, async ({ request }) => {
				body = new URLSearchParams(await request.text())
				return HttpResponse.json({ success: true })
			})
		)
		const provider = hcaptchaProvider({ secretKey: 'sec' })
		const passed = await provider.verify({
			token: 'tok',
			req: reqWith({ 'x-forwarded-for': '5.6.7.8' }),
		})
		expect(passed).toBe(true)
		expect(body?.get('secret')).toBe('sec')
		expect(body?.get('response')).toBe('tok')
		expect(body?.get('remoteip')).toBe('5.6.7.8')
	})

	it('fails on success:false with error codes', async () => {
		server.use(
			http.post(VERIFY_URL, () =>
				HttpResponse.json({ success: false, 'error-codes': ['invalid-input-response'] })
			)
		)
		const provider = hcaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'bad', req: reqWith() })).toBe(false)
	})

	it('fails closed on a non-2xx response', async () => {
		server.use(http.post(VERIFY_URL, () => new HttpResponse(null, { status: 503 })))
		const provider = hcaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(false)
	})

	it('fails closed on a network error', async () => {
		server.use(http.post(VERIFY_URL, () => HttpResponse.error()))
		const provider = hcaptchaProvider({ secretKey: 'sec' })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(false)
	})

	it('supports a custom verifyUrl', async () => {
		server.use(http.post('https://hc.test/siteverify', () => HttpResponse.json({ success: true })))
		const provider = hcaptchaProvider({ secretKey: 'sec', verifyUrl: 'https://hc.test/siteverify' })
		expect(await provider.verify({ token: 'tok', req: reqWith() })).toBe(true)
	})
})
