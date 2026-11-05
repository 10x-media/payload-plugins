import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { refusedSameSite } from './sameSite'

describe('refusedSameSite', () => {
	const request = (headers: Record<string, string>): PayloadRequest =>
		Object.assign(new Request('https://b.platform.example/api/_x/e', { method: 'POST', headers }), {
			payload: {},
		}) as unknown as PayloadRequest
	const tenantOf = async (req: PayloadRequest): Promise<string | null> => {
		const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
		return host?.endsWith('.platform.example') && !host.startsWith('www.')
			? (host.split('.')[0] ?? null)
			: null
	}
	const own = () => Promise.resolve('b')

	it("refuses a sibling subdomain's page whose origin resolves another scope, whichever host header it reads", async () => {
		const sibling = { 'sec-fetch-site': 'same-site', origin: 'https://a.platform.example' }
		expect(
			await refusedSameSite(request({ host: 'b.platform.example', ...sibling }), own, tenantOf)
		).toBe(true)
		expect(
			await refusedSameSite(
				request({ host: 'internal', 'x-forwarded-host': 'b.platform.example', ...sibling }),
				own,
				tenantOf
			)
		).toBe(true)
	})

	it('passes its own scope, an origin no scope answers for, and every other kind of request', async () => {
		const scope = vi.fn(own)
		const from = (headers: Record<string, string>) =>
			refusedSameSite(request(headers), scope, tenantOf)
		expect(
			await from({ 'sec-fetch-site': 'same-site', origin: 'https://b.platform.example' })
		).toBe(false)
		expect(
			await from({ 'sec-fetch-site': 'same-site', origin: 'https://www.platform.example' })
		).toBe(false)
		expect(await from({ 'sec-fetch-site': 'same-site', origin: 'null' })).toBe(false)
		expect(await from({ 'sec-fetch-site': 'same-site' })).toBe(false)
		expect(
			await from({ 'sec-fetch-site': 'same-origin', origin: 'https://a.platform.example' })
		).toBe(false)
		expect(await from({ origin: 'https://a.platform.example' })).toBe(false)
		expect(scope).toHaveBeenCalledTimes(1)
	})
})
