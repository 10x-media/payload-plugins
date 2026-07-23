import { describe, expect, it } from 'vitest'
import { DEFAULT_HONEYPOT_FIELD } from './constants'
import { resolveSpamConfig } from './resolveSpam'

describe('resolveSpamConfig', () => {
	it('defaults: honeypot + both rate limits on, no captcha, no meta capture', () => {
		const resolved = resolveSpamConfig(undefined)
		if (resolved === false) {
			throw new Error('expected resolved config')
		}
		expect(resolved.honeypot).toEqual({ fieldName: DEFAULT_HONEYPOT_FIELD })
		expect(resolved.rateLimit).not.toBe(false)
		expect(resolved.uploadRateLimit).not.toBe(false)
		expect(resolved.captcha).toBeUndefined()
		expect(resolved.metadata).toEqual({ ip: false, ua: false })
		expect(resolved.ipHeader).toBe('x-forwarded-for')
		expect(resolved.uploadOwnership).toBe('lenient')
	})

	it('honors an explicit strict upload-ownership mode', () => {
		const resolved = resolveSpamConfig({ uploadOwnership: 'strict' })
		if (resolved === false) {
			throw new Error('expected resolved config')
		}
		expect(resolved.uploadOwnership).toBe('strict')
	})

	it('spam: false disables the whole subsystem', () => {
		expect(resolveSpamConfig(false)).toBe(false)
	})

	it('honors per-control false and overrides', () => {
		const resolved = resolveSpamConfig({
			honeypot: false,
			rateLimit: { window: 1000, max: 2 },
			uploadRateLimit: false,
			metadata: { ip: true },
		})
		if (resolved === false) {
			throw new Error('expected resolved config')
		}
		expect(resolved.honeypot).toBe(false)
		expect(resolved.rateLimit).toMatchObject({ window: 1000, max: 2 })
		expect(resolved.uploadRateLimit).toBe(false)
		expect(resolved.metadata).toEqual({ ip: true, ua: false })
	})

	it('honors a custom honeypot field name', () => {
		const resolved = resolveSpamConfig({ honeypot: { fieldName: 'website' } })
		if (resolved === false) {
			throw new Error('expected resolved config')
		}
		expect(resolved.honeypot).toEqual({ fieldName: 'website' })
	})
})
