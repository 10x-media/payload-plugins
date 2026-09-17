import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { isJsonContentType, verifyMutationOrigin } from './origin'

const payloadOf = (overrides: Record<string, unknown> = {}): Payload =>
	({
		config: {
			auth: { jwtOrder: ['JWT', 'Bearer', 'cookie'] },
			csrf: [],
			serverURL: '',
			...overrides,
		},
	}) as unknown as Payload

const options = { security: { trustedOrigins: [] as string[] } }

const headersOf = (init: Record<string, string>) => new Headers(init)

describe('verifyMutationOrigin', () => {
	it('allows JWT Authorization when jwtOrder ranks JWT before cookie', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ Authorization: 'JWT abc' }),
				options,
				payload: payloadOf(),
			})
		).toBe(true)
	})

	it('allows Bearer Authorization when jwtOrder ranks Bearer before cookie', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ Authorization: 'Bearer abc' }),
				options,
				payload: payloadOf(),
			})
		).toBe(true)
	})

	it('does not skip the gate for a junk Authorization when cookie ranks first', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({
					Authorization: 'JWT abc',
					Origin: 'https://evil.example',
					'Sec-Fetch-Site': 'cross-site',
				}),
				options,
				payload: payloadOf({ auth: { jwtOrder: ['cookie', 'JWT', 'Bearer'] } }),
			})
		).toBe(false)
	})

	it('denies cross-site', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ 'Sec-Fetch-Site': 'cross-site' }),
				options,
				payload: payloadOf(),
			})
		).toBe(false)
	})

	it('denies same-site', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ 'Sec-Fetch-Site': 'same-site' }),
				options,
				payload: payloadOf(),
			})
		).toBe(false)
	})

	it('allows same-origin via Sec-Fetch-Site', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ 'Sec-Fetch-Site': 'same-origin' }),
				options,
				payload: payloadOf(),
			})
		).toBe(true)
	})

	it('denies when Origin and Sec-Fetch-Site are both missing', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({}),
				options,
				payload: payloadOf(),
			})
		).toBe(false)
	})

	it('denies an Origin whose host does not match Host when the allowlist is empty', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ host: 'localhost:3000', Origin: 'https://evil.example' }),
				options,
				payload: payloadOf(),
			})
		).toBe(false)
	})

	it('allows Origin host matching Host when the allowlist is empty', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ host: 'localhost:3000', Origin: 'http://localhost:3000' }),
				options,
				payload: payloadOf(),
			})
		).toBe(true)
	})

	it('requires Origin to be in the allowlist when serverURL or csrf is set', () => {
		const payload = payloadOf({ csrf: ['https://cms.example'], serverURL: 'https://cms.example' })
		expect(
			verifyMutationOrigin({
				headers: headersOf({ Origin: 'https://cms.example' }),
				options,
				payload,
			})
		).toBe(true)
		expect(
			verifyMutationOrigin({
				headers: headersOf({ Origin: 'https://other.example' }),
				options,
				payload,
			})
		).toBe(false)
	})

	it('honours trustedOrigins', () => {
		expect(
			verifyMutationOrigin({
				headers: headersOf({ Origin: 'https://app.example' }),
				options: { security: { trustedOrigins: ['https://app.example'] } },
				payload: payloadOf(),
			})
		).toBe(true)
	})
})

describe('isJsonContentType', () => {
	it('accepts application/json with a charset', () => {
		expect(
			isJsonContentType(headersOf({ 'Content-Type': 'application/json; charset=utf-8' }))
		).toBe(true)
	})

	it('rejects missing or form content types', () => {
		expect(isJsonContentType(headersOf({}))).toBe(false)
		expect(
			isJsonContentType(headersOf({ 'Content-Type': 'application/x-www-form-urlencoded' }))
		).toBe(false)
	})
})
