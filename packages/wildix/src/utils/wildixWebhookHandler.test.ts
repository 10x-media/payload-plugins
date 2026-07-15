import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyWebhookSignature } from './wildixWebhookHandler'

const sign = (body: string, secret: string) =>
	createHmac('sha256', secret).update(body).digest('hex')

describe('verifyWebhookSignature', () => {
	it('accepts any request when no secret is configured (dev mode)', () => {
		expect(verifyWebhookSignature('{"event":"call:start"}', null, undefined)).toBe(true)
	})

	it('rejects a missing signature when a secret is configured', () => {
		expect(verifyWebhookSignature('{"event":"call:start"}', null, 'shh')).toBe(false)
	})

	it('accepts a signature matching the HMAC-SHA256 of the raw body', () => {
		const body = '{"event":"call:completed"}'
		const secret = 'shh'
		expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true)
	})

	it('rejects a signature signed with the wrong secret', () => {
		const body = '{"event":"call:completed"}'
		expect(verifyWebhookSignature(body, sign(body, 'wrong-secret'), 'shh')).toBe(false)
	})

	it('rejects a signature for a tampered body', () => {
		const secret = 'shh'
		const signature = sign('{"event":"call:start"}', secret)
		expect(verifyWebhookSignature('{"event":"call:completed"}', signature, secret)).toBe(false)
	})
})
