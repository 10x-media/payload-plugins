import { describe, expect, it } from 'vitest'

import { signToken, verifyToken } from './tokens'

const claims = {
	channels: ['internal'],
	exp: Date.now() + 60_000,
	instance: 'comments',
	key: 'collection:persons:1',
	userKey: 'users:1',
}

describe('subscription tokens', () => {
	it('verifies what it signed', () => {
		expect(verifyToken('secret', signToken('secret', claims))).toEqual(claims)
	})

	it('rejects another secret', () => {
		expect(verifyToken('other', signToken('secret', claims))).toBeNull()
	})

	it('rejects an expired token', () => {
		const token = signToken('secret', { ...claims, exp: 1000 })
		expect(verifyToken('secret', token, 2000)).toBeNull()
	})

	it('rejects tampered channels', () => {
		const token = signToken('secret', claims)
		const [, signature] = token.split('.')
		const forged = Buffer.from(
			JSON.stringify([
				claims.instance,
				claims.userKey,
				claims.key,
				['internal', 'shared'],
				claims.exp,
			])
		).toString('base64url')
		expect(verifyToken('secret', `${forged}.${signature}`)).toBeNull()
	})

	it.each([undefined, '', 'a', 'a.b.c', 'x.y'])('rejects malformed %j', (token) => {
		expect(verifyToken('secret', token)).toBeNull()
	})
})
