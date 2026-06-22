import { describe, expect, it } from 'vitest'
import type { SubmissionValue } from '../submissions/types'
import { CAPTCHA_TOKEN_KEY } from './constants'
import { extractReservedValues, isHoneypotTripped } from './reserved'

const v = (field: string, value: unknown): SubmissionValue => ({ field, value })

describe('extractReservedValues', () => {
	it('pulls out honeypot + captcha and leaves real fields', () => {
		const { cleaned, honeypot, captchaToken } = extractReservedValues(
			[v('name', 'Jo'), v('confirm_email', 'bot@x.com'), v(CAPTCHA_TOKEN_KEY, 'tok')],
			'confirm_email'
		)
		expect(cleaned).toEqual([v('name', 'Jo')])
		expect(honeypot).toBe('bot@x.com')
		expect(captchaToken).toBe('tok')
	})

	it('keeps the honeypot-named entry when honeypot is disabled (null field)', () => {
		const { cleaned, honeypot } = extractReservedValues([v('confirm_email', 'x')], null)
		expect(cleaned).toEqual([v('confirm_email', 'x')])
		expect(honeypot).toBeUndefined()
	})

	it('ignores a non-string captcha token', () => {
		const { captchaToken } = extractReservedValues([v(CAPTCHA_TOKEN_KEY, 123)], 'confirm_email')
		expect(captchaToken).toBeUndefined()
	})
})

describe('isHoneypotTripped', () => {
	it('true only for a non-empty value', () => {
		expect(isHoneypotTripped('x')).toBe(true)
		expect(isHoneypotTripped('')).toBe(false)
		expect(isHoneypotTripped(undefined)).toBe(false)
		expect(isHoneypotTripped(null)).toBe(false)
		expect(isHoneypotTripped([])).toBe(false)
	})
})
