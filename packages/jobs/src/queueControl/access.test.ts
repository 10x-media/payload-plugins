import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import { cronSecretAccess, loggedInAccess } from './access'

const reqWith = (over: { user?: unknown; authorization?: string }): PayloadRequest =>
	({
		headers: new Headers(over.authorization ? { authorization: over.authorization } : {}),
		user: over.user ?? null,
	}) as unknown as PayloadRequest

describe('loggedInAccess', () => {
	it('passes a logged-in user and rejects an anonymous request', () => {
		expect(loggedInAccess({ req: reqWith({ user: { id: '1' } }) })).toBe(true)
		expect(loggedInAccess({ req: reqWith({}) })).toBe(false)
	})
})

describe('cronSecretAccess', () => {
	afterEach(() => {
		// biome-ignore lint/plugin/noProcessEnv: test env cleanup
		process.env.CRON_SECRET = undefined
	})

	it('passes a logged-in user regardless of the header', () => {
		expect(cronSecretAccess()({ req: reqWith({ user: { id: '1' } }) })).toBe(true)
	})

	it('rejects when no secret is configured', () => {
		expect(cronSecretAccess()({ req: reqWith({ authorization: 'Bearer x' }) })).toBe(false)
	})

	it('matches a correct Bearer secret and rejects a wrong one', () => {
		// biome-ignore lint/plugin/noProcessEnv: test arranges the secret it reads
		process.env.CRON_SECRET = 's3cret'
		expect(cronSecretAccess()({ req: reqWith({ authorization: 'Bearer s3cret' }) })).toBe(true)
		expect(cronSecretAccess()({ req: reqWith({ authorization: 'Bearer nope' }) })).toBe(false)
	})

	it('rejects a secret that is a different byte length without timing leak', () => {
		// biome-ignore lint/plugin/noProcessEnv: test arranges the secret it reads
		process.env.CRON_SECRET = 'abc'
		// 'abcd' is one byte longer than 'abc' — must be rejected, not throw
		expect(cronSecretAccess()({ req: reqWith({ authorization: 'Bearer abcd' }) })).toBe(false)
		// 'ab' is one byte shorter — must also be rejected
		expect(cronSecretAccess()({ req: reqWith({ authorization: 'Bearer ab' }) })).toBe(false)
	})
})
