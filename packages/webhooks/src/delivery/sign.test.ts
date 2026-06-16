import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signatureHeader, signPayload } from './sign'

describe('signPayload', () => {
	const args = { secret: 's3cr3t', timestamp: 1_700_000_000, body: '{"a":1}' }

	it('signs the timestamp.body message with HMAC-SHA256 hex', () => {
		const expected = createHmac('sha256', args.secret)
			.update(`${args.timestamp}.${args.body}`)
			.digest('hex')
		expect(signPayload(args)).toBe(expected)
		expect(signPayload(args)).toMatch(/^[0-9a-f]{64}$/)
	})

	it('changes when any input changes', () => {
		const base = signPayload(args)
		expect(signPayload({ ...args, body: '{"a":2}' })).not.toBe(base)
		expect(signPayload({ ...args, timestamp: args.timestamp + 1 })).not.toBe(base)
		expect(signPayload({ ...args, secret: 'other' })).not.toBe(base)
	})
})

describe('signatureHeader', () => {
	it('prefixes the version tag', () => {
		expect(signatureHeader('abc')).toBe('v1=abc')
	})
})
