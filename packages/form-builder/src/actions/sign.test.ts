import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SIGNATURE_HEADER, signPayload } from './sign'

describe('signPayload', () => {
	it('produces v1=<64-hex-chars>', () => {
		const result = signPayload('{"hello":"world"}', 's3cr3t')
		expect(result).toMatch(/^v1=[0-9a-f]{64}$/)
	})

	it('matches a known vector', () => {
		const body = '{"hello":"world"}'
		const secret = 's3cr3t'
		const expected = `v1=${createHmac('sha256', secret).update(body).digest('hex')}`
		expect(signPayload(body, secret)).toBe(expected)
	})

	it('changes when body changes', () => {
		const a = signPayload('a', 'sec')
		const b = signPayload('b', 'sec')
		expect(a).not.toBe(b)
	})

	it('changes when secret changes', () => {
		const a = signPayload('body', 'sec1')
		const b = signPayload('body', 'sec2')
		expect(a).not.toBe(b)
	})
})

describe('SIGNATURE_HEADER', () => {
	it('is X-Form-Signature (distinct from the webhooks plugin header)', () => {
		expect(SIGNATURE_HEADER).toBe('X-Form-Signature')
	})
})
