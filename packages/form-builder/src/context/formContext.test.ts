import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { signFormContext, verifyFormContext } from './formContext'

const payload = { secret: 'test-secret' } as unknown as Payload

describe('form context signing', () => {
	it('signs and verifies a numeric reference round-trip', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 42 })
		expect(verifyFormContext(token, 'test-secret')).toEqual({ relationTo: 'people', value: 42 })
	})

	it('preserves a string value', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 'abc' })
		expect(verifyFormContext(token, 'test-secret')).toEqual({ relationTo: 'people', value: 'abc' })
	})

	it('rejects a payload tampered under the original signature', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 42 })
		const [version, , sig] = token.split('.')
		const forged = Buffer.from(
			JSON.stringify({ relationTo: 'people', value: 99, exp: 9_999_999_999 })
		).toString('base64url')
		expect(verifyFormContext(`${version}.${forged}.${sig}`, 'test-secret')).toBeNull()
	})

	it('rejects a wrong secret', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 42 })
		expect(verifyFormContext(token, 'other-secret')).toBeNull()
	})

	it('rejects an expired token', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 42, expiresIn: 60 })
		expect(verifyFormContext(token, 'test-secret', Date.now() + 120_000)).toBeNull()
	})

	it('accepts a token that has not yet expired', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 7, expiresIn: 3600 })
		expect(verifyFormContext(token, 'test-secret', Date.now() + 60_000)).toEqual({
			relationTo: 'people',
			value: 7,
		})
	})

	it('rejects malformed tokens', () => {
		expect(verifyFormContext('nope', 'test-secret')).toBeNull()
		expect(verifyFormContext('v1.onlytwo', 'test-secret')).toBeNull()
		expect(verifyFormContext('v2.body.sig', 'test-secret')).toBeNull()
	})

	it('honors a secret override', () => {
		const token = signFormContext({ payload, relationTo: 'people', value: 1, secret: 'override' })
		expect(verifyFormContext(token, 'override')).toEqual({ relationTo: 'people', value: 1 })
		expect(verifyFormContext(token, 'test-secret')).toBeNull()
	})
})
