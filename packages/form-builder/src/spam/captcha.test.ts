import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { defineCaptchaProvider } from './captcha'

describe('defineCaptchaProvider', () => {
	it('returns the provider and preserves verify identity', async () => {
		const provider = defineCaptchaProvider({
			type: 'stub',
			verify: async ({ token }) => token === 'good',
		})
		expect(provider.type).toBe('stub')
		expect(await provider.verify({ token: 'good', req: {} as PayloadRequest })).toBe(true)
		expect(await provider.verify({ token: 'bad', req: {} as PayloadRequest })).toBe(false)
	})
})
