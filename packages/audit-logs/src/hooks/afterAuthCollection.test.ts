import {
	AuthenticationError,
	Forbidden,
	LockedAuth,
	NotFound,
	type PayloadRequest,
	UnverifiedEmail,
} from 'payload'
import { describe, expect, it } from 'vitest'

import { failedLoginReason, isLoginRoute, loginIdentifier } from './afterAuthCollection'

const req = (props: Record<string, unknown>) => props as unknown as PayloadRequest

describe('failedLoginReason', () => {
	it('names the three ways Payload refuses a login', () => {
		expect(failedLoginReason(new AuthenticationError())).toBe('invalid_credentials')
		expect(failedLoginReason(new LockedAuth())).toBe('locked')
		expect(failedLoginReason(new UnverifiedEmail({}))).toBe('unverified')
	})

	it('ignores every other error the collection can raise', () => {
		expect(failedLoginReason(new NotFound())).toBeUndefined()
		expect(failedLoginReason(new Forbidden())).toBeUndefined()
		expect(failedLoginReason(new Error('boom'))).toBeUndefined()
		expect(failedLoginReason(undefined)).toBeUndefined()
		expect(failedLoginReason('AuthenticationError')).toBeUndefined()
	})

	/**
	 * Pins the mechanism, not just the outcome. Next minifies the server build, so
	 * `error.name` (which `APIError` copies off its constructor) arrives as something
	 * like `ac`. A matcher keyed on the name passes every test above and records
	 * nothing at all in production.
	 */
	it('does not go by the name, which the production build mangles', () => {
		expect(failedLoginReason({ name: 'AuthenticationError' })).toBeUndefined()

		const minified = new AuthenticationError()
		Object.defineProperty(minified, 'name', { value: 'ac' })
		expect(failedLoginReason(minified)).toBe('invalid_credentials')
	})
})

describe('isLoginRoute', () => {
	// `afterError` fires for every REST error on the collection, and the error classes
	// above are raised by more than one auth endpoint, so the path has to agree too.
	it('accepts the login endpoint under any api route prefix', () => {
		expect(isLoginRoute(req({ pathname: '/api/users/login' }))).toBe(true)
		expect(isLoginRoute(req({ pathname: '/custom-api/admins/login' }))).toBe(true)
	})

	it('rejects the other auth endpoints', () => {
		expect(isLoginRoute(req({ pathname: '/api/users/refresh-token' }))).toBe(false)
		expect(isLoginRoute(req({ pathname: '/api/users/unlock' }))).toBe(false)
		expect(isLoginRoute(req({ pathname: '/api/users/me' }))).toBe(false)
		expect(isLoginRoute(req({}))).toBe(false)
	})
})

describe('loginIdentifier', () => {
	it('reads whichever of the two Payload accepts', () => {
		expect(loginIdentifier(req({ data: { email: 'a@b.c', password: 'hunter2' } }))).toBe('a@b.c')
		expect(loginIdentifier(req({ data: { username: 'admin', password: 'hunter2' } }))).toBe('admin')
	})

	it('is undefined when nothing usable was submitted', () => {
		expect(loginIdentifier(req({}))).toBeUndefined()
		expect(loginIdentifier(req({ data: {} }))).toBeUndefined()
		expect(loginIdentifier(req({ data: { email: 42 } }))).toBeUndefined()
	})

	// The value is whatever an anonymous caller put in the body, so it is capped before
	// it reaches a row.
	it('caps what an anonymous caller can write into a row', () => {
		const identifier = loginIdentifier(req({ data: { email: 'x'.repeat(500) } }))
		expect(identifier).toHaveLength(256)
	})
})
